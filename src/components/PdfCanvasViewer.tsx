import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Loader2,
  Maximize2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ReaderTheme } from '../types';
import { fetchR2StorageStatus } from '../services/r2StorageService';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfCanvasViewerProps {
  fileUrl: string;
  iframeSrc: string;
  title: string;
  allowDownload: boolean;
  theme: ReaderTheme;
  currentPage: number;
  totalPages: number;
  onTotalPagesChange: (total: number) => void;
  onPageChange: (page: number) => void;
}

async function resolveSameOriginR2FallbackUrl(rawUrl: string): Promise<string | null> {
  if (!rawUrl || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) {
    return null;
  }

  if (rawUrl.startsWith('/api/r2-storage/file/')) {
    const clean = rawUrl.split('?')[0];
    return `${clean}?inline=1`;
  }

  try {
    const status = await fetchR2StorageStatus();
    if (status.publicUrl) {
      const cleanBase = status.publicUrl.replace(/\/+$/, '');
      if (rawUrl.startsWith(`${cleanBase}/`)) {
        const keyPart = rawUrl.slice(cleanBase.length + 1).split('?')[0];
        if (keyPart.startsWith('books/') || keyPart.startsWith('covers/')) {
          return `/api/r2-storage/file/${keyPart}?inline=1`;
        }
      }
    }
  } catch {
    // Ignore status lookup error
  }

  try {
    const parsed = new URL(rawUrl, window.location.origin);
    const trimmedPath = parsed.pathname.replace(/^\/+/, '');
    if (
      (parsed.hostname.endsWith('.r2.dev') ||
        parsed.hostname.endsWith('.r2.cloudflarestorage.com')) &&
      (trimmedPath.startsWith('books/') || trimmedPath.startsWith('covers/'))
    ) {
      return `/api/r2-storage/file/${trimmedPath}?inline=1`;
    }
  } catch {
    // Ignore URL parse error
  }

  return null;
}

function normalizeInitialPdfUrl(rawUrl: string): string {
  if (rawUrl.startsWith('/api/r2-storage/file/')) {
    const [base, query = ''] = rawUrl.split('?');
    const params = new URLSearchParams(query);
    if (!params.has('inline')) {
      params.set('inline', '1');
    }
    return `${base}?${params.toString()}`;
  }
  return rawUrl;
}

export function PdfCanvasViewer({
  fileUrl,
  iframeSrc,
  title,
  allowDownload,
  theme,
  currentPage,
  totalPages,
  onTotalPagesChange,
  onPageChange,
}: PdfCanvasViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<pdfjsLib.PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const onTotalPagesChangeRef = useRef(onTotalPagesChange);
  onTotalPagesChangeRef.current = onTotalPagesChange;

  const [pdfReadyDoc, setPdfReadyDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadingPdf, setLoadingPdf] = useState<boolean>(true);
  const [renderingPage, setRenderingPage] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>('');
  const [useIframeFallback, setUseIframeFallback] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(1);
  const [containerWidth, setContainerWidth] = useState<number>(760);

  // Track viewport width for crisp responsive canvas sizing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateWidth = () => {
      const nextWidth = Math.max(260, Math.floor(el.clientWidth - 24));
      setContainerWidth(nextWidth);
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Load PDF document using pdfjs-dist with automatic same-origin R2 fallback if CORS blocks direct fetch
  useEffect(() => {
    let cancelled = false;

    const destroyCurrentDoc = async () => {
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          // Ignore cancel error
        }
        renderTaskRef.current = null;
      }
      if (pdfDocRef.current) {
        try {
          await pdfDocRef.current.cleanup();
        } catch {
          // Ignore cleanup error
        }
        pdfDocRef.current = null;
      }
      if (loadingTaskRef.current) {
        try {
          await loadingTaskRef.current.destroy();
        } catch {
          // Ignore destroy error
        }
        loadingTaskRef.current = null;
      }
    };

    const loadDocument = async () => {
      await destroyCurrentDoc();
      if (cancelled) return;

      setPdfReadyDoc(null);
      setLoadingPdf(true);
      setLoadError('');
      setUseIframeFallback(false);

      const primaryUrl = normalizeInitialPdfUrl(fileUrl);
      const candidates = [primaryUrl];
      const sameOriginFallback = await resolveSameOriginR2FallbackUrl(fileUrl);
      if (sameOriginFallback && sameOriginFallback !== primaryUrl) {
        candidates.push(sameOriginFallback);
      }

      let lastErr: unknown = null;

      for (const candidateUrl of candidates) {
        if (cancelled) return;
        try {
          const task = pdfjsLib.getDocument({
            url: candidateUrl,
            withCredentials: false,
          });
          loadingTaskRef.current = task;
          const doc = await task.promise;
          if (cancelled) {
            await task.destroy().catch(() => {});
            return;
          }
          pdfDocRef.current = doc;
          setPdfReadyDoc(doc);
          setLoadingPdf(false);
          onTotalPagesChangeRef.current(doc.numPages);
          return;
        } catch (err) {
          lastErr = err;
          if (loadingTaskRef.current) {
            try {
              await loadingTaskRef.current.destroy();
            } catch {
              // Ignore destroy error
            }
            loadingTaskRef.current = null;
          }
        }
      }

      if (!cancelled) {
        setLoadingPdf(false);
        const msg =
          lastErr instanceof Error && lastErr.message
            ? lastErr.message
            : 'Faylka PDF-ka si toos ah looma soo rogi karin.';
        setLoadError(msg);
        setUseIframeFallback(true);
      }
    };

    void loadDocument();

    return () => {
      cancelled = true;
      void destroyCurrentDoc();
    };
  }, [fileUrl]);

  // Render active page to high-DPI canvas
  useEffect(() => {
    if (!pdfReadyDoc || !canvasRef.current) return;

    let cancelled = false;
    const safePage = Math.max(1, Math.min(pdfReadyDoc.numPages, currentPage));

    const renderPage = async () => {
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          // Ignore cancel error
        }
        renderTaskRef.current = null;
      }

      setRenderingPage(true);
      try {
        const page = await pdfReadyDoc.getPage(safePage);
        if (cancelled || !canvasRef.current) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const maxDisplayWidth = Math.min(containerWidth, 920);
        const fitScale = maxDisplayWidth / Math.max(1, baseViewport.width);
        const targetCssWidth = baseViewport.width * fitScale * zoom;
        const targetCssHeight = baseViewport.height * fitScale * zoom;
        const outputScale = Math.min(window.devicePixelRatio || 1, 2.5);

        const renderViewport = page.getViewport({
          scale: fitScale * zoom * outputScale,
        });

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = Math.max(1, Math.floor(renderViewport.width));
        canvas.height = Math.max(1, Math.floor(renderViewport.height));
        canvas.style.width = `${Math.floor(targetCssWidth)}px`;
        canvas.style.height = `${Math.floor(targetCssHeight)}px`;

        const renderTask = page.render({
          canvas,
          canvasContext: ctx,
          viewport: renderViewport,
        });
        renderTaskRef.current = renderTask;

        await renderTask.promise;
        if (!cancelled) {
          setRenderingPage(false);
        }
      } catch (err) {
        const errName =
          typeof err === 'object' && err !== null && 'name' in err
            ? String((err as { name?: unknown }).name)
            : '';
        if (errName !== 'RenderingCancelledException' && !cancelled) {
          setRenderingPage(false);
        }
      }
    };

    void renderPage();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          // Ignore cancel error
        }
      }
    };
  }, [pdfReadyDoc, currentPage, zoom, containerWidth]);

  // Keyboard navigation inside PDF reader
  useEffect(() => {
    if (!pdfReadyDoc) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        if (currentPage < totalPages) {
          e.preventDefault();
          onPageChange(currentPage + 1);
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        if (currentPage > 1) {
          e.preventDefault();
          onPageChange(currentPage - 1);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pdfReadyDoc, currentPage, totalPages, onPageChange]);

  const surfaceBg =
    theme === 'dark'
      ? 'bg-[#111110]'
      : theme === 'sepia'
      ? 'bg-[#EAE0CB]'
      : 'bg-[#F3F0E9]';

  const barStyle =
    theme === 'dark'
      ? 'bg-[#1C1B19] border-[#2E2C29] text-[#E7E5E4]'
      : theme === 'sepia'
      ? 'bg-[#E5D7BC] border-[#D9C8A9] text-[#3B2F23]'
      : 'bg-[#FFFFFF] border-[#E5E0D5] text-[#1C1917]';

  if (useIframeFallback) {
    return (
      <div className={`flex-1 flex flex-col ${surfaceBg}`}>
        <div className={`px-4 py-2.5 border-b text-xs flex flex-wrap items-center justify-between gap-2 ${barStyle}`}>
          <span className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 shrink-0" />
            <span>
              {loadError
                ? 'Faylka waxaa lagu furay qaabka caadiga ah (embed).'
                : 'Qaabka caadiga ah'}
            </span>
          </span>
          {allowDownload && iframeSrc && (
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#14532D] text-white font-medium hover:bg-[#0F3F22] transition-colors whitespace-nowrap"
            >
              Ku fur Daaqad Cusub
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
        <iframe
          src={iframeSrc}
          title={title}
          className={`w-full flex-1 border-0 min-h-[72vh] ${
            theme === 'dark' ? 'bg-[#1F1E1C]' : 'bg-white'
          }`}
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`flex-1 flex flex-col min-h-0 ${surfaceBg}`}>
      {/* Zoom & Fit Controls */}
      <div className={`px-4 py-2 border-b flex items-center justify-between gap-3 text-xs ${barStyle}`}>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.15).toFixed(2))))}
            aria-label="Yaree PDF-ka"
            className="p-1.5 rounded-md border border-current/20 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="font-mono tabular-nums min-w-[44px] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.15).toFixed(2))))}
            aria-label="Weynee PDF-ka"
            className="p-1.5 rounded-md border border-current/20 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          {zoom !== 1 && (
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-current/20 hover:bg-black/5 dark:hover:bg-white/10 transition-colors ml-1"
            >
              <Maximize2 className="w-3 h-3" />
              <span>Buuxa</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 font-mono tabular-nums">
          {renderingPage && <Loader2 className="w-3.5 h-3.5 animate-spin opacity-70" />}
          <span>
            Bogga {Math.min(currentPage, totalPages)} / {totalPages}
          </span>
        </div>
      </div>

      {/* Canvas Viewport */}
      <div
        className="flex-1 overflow-auto p-3 sm:p-6 flex flex-col items-center"
        onContextMenu={!allowDownload ? (e) => e.preventDefault() : undefined}
      >
        {loadingPdf ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-[#14532D] dark:text-[#4ADE80] mb-3" />
            <p className="text-sm opacity-80">Faylka PDF-ka waa la furayaa...</p>
          </div>
        ) : (
          <div className="relative bg-white shadow-lg rounded-sm overflow-hidden border border-black/10 max-w-full">
            <canvas ref={canvasRef} className="block max-w-none" />
          </div>
        )}
      </div>

      {/* Bottom Touch Page Navigation */}
      {!loadingPdf && totalPages > 1 && (
        <div
          className={`px-4 py-2.5 border-t flex items-center justify-between gap-3 text-xs ${barStyle}`}
        >
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => {
              onPageChange(currentPage - 1);
              containerRef.current?.querySelector('.overflow-auto')?.scrollTo({ top: 0 });
            }}
            className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 rounded-lg border border-current/20 font-medium hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Bogga Hore
          </button>

          <span className="font-mono tabular-nums opacity-80">
            {currentPage} / {totalPages}
          </span>

          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => {
              onPageChange(currentPage + 1);
              containerRef.current?.querySelector('.overflow-auto')?.scrollTo({ top: 0 });
            }}
            className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 rounded-lg bg-[#14532D] text-white font-medium hover:bg-[#0F3F22] disabled:opacity-40 transition-colors"
          >
            Bogga Xiga
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
