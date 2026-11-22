import { useEffect, useMemo, useState } from 'react';
import { Search, Shield, UserCheck } from 'lucide-react';
import {
  extractErrorMessage,
  subscribeUsersAndPresence,
  updateUserRole,
} from '../services/libraryService';
import type { PresenceRecord, UserProfile, UserRole } from '../types';
import { UserAvatar } from './UserAvatar';

export type AdminUserWithPresence = UserProfile & { presence: PresenceRecord };

interface AdminUsersPanelProps {
  currentAdminUid: string;
  totalBooksCount: number;
  embedded?: boolean;
  usersOverride?: AdminUserWithPresence[];
  loadingOverride?: boolean;
  onNotify?: (msg: string) => void;
}

function formatLastSeen(value: unknown): string {
  if (!value) return 'Lama hayo';
  try {
    if (typeof value === 'number') {
      return new Date(value).toLocaleString('so-SO', {
        dateStyle: 'short',
        timeStyle: 'short',
      });
    }
    if (typeof value === 'object' && value !== null && 'toDate' in value) {
      const d = (value as { toDate: () => Date }).toDate();
      return d.toLocaleString('so-SO', {
        dateStyle: 'short',
        timeStyle: 'short',
      });
    }
  } catch {
    return 'Hadda';
  }
  return 'Hadda';
}

export function AdminUsersPanel({
  currentAdminUid,
  totalBooksCount,
  embedded = false,
  usersOverride,
  loadingOverride,
  onNotify,
}: AdminUsersPanelProps) {
  const [internalUsers, setInternalUsers] = useState<AdminUserWithPresence[]>([]);
  const [internalLoading, setInternalLoading] = useState(true);
  const [updatingUid, setUpdatingUid] = useState<string | null>(null);
  const [queryText, setQueryText] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'online' | 'admin' | 'user'>('all');

  useEffect(() => {
    if (usersOverride) return;
    const unsub = subscribeUsersAndPresence(
      (merged) => {
        setInternalUsers(merged);
        setInternalLoading(false);
      },
      (errMsg) => {
        setInternalLoading(false);
        onNotify?.(`Liiska isticmaalayaasha lama soo dejin karin: ${errMsg}`);
      }
    );
    return () => unsub();
  }, [usersOverride, onNotify]);

  const users = usersOverride ?? internalUsers;
  const loading = usersOverride ? Boolean(loadingOverride) : internalLoading;

  const onlineCount = users.filter((u) => u.presence.online).length;
  const adminCount = users.filter((u) => u.role === 'admin').length;

  const filteredUsers = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    return users.filter((u) => {
      if (filterMode === 'online' && !u.presence.online) return false;
      if (filterMode === 'admin' && u.role !== 'admin') return false;
      if (filterMode === 'user' && u.role !== 'user') return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      );
    });
  }, [users, queryText, filterMode]);

  const handleToggleRole = async (target: UserProfile) => {
    if (target.uid === currentAdminUid) return;
    const nextRole: UserRole = target.role === 'admin' ? 'user' : 'admin';
    setUpdatingUid(target.uid);
    try {
      await updateUserRole(target.uid, nextRole);
      onNotify?.(
        nextRole === 'admin'
          ? `${target.name} waxaa laga dhigay Admin.`
          : `${target.name} waxaa laga dhigay Reader.`
      );
    } catch (err) {
      onNotify?.(`Doorka isticmaalaha lama beddeli karin: ${extractErrorMessage(err)}`);
    } finally {
      setUpdatingUid(null);
    }
  };

  return (
    <div className={embedded ? '' : 'max-w-6xl mx-auto px-6 py-10'}>
      {!embedded && (
        <>
          <div className="mb-8 border-b border-[#E5E0D5] dark:border-[#2E2C29] pb-5">
            <p className="text-xs tracking-widest uppercase text-[#78716C] dark:text-[#A8A29E] mb-1">
              La Socodka Tooska ah (Realtime Presence)
            </p>
            <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
              Isticmaalayaasha & Xaaladda Online / Offline
            </h2>
            <p className="text-sm text-[#57534E] dark:text-[#A8A29E] mt-1">
              Liiska akhristayaasha iyo maamulayaasha diiwaangashan, tirada buugagga ay kaydsadeen, iyo xaaladdooda tooska ah.
            </p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="bg-white dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-5">
              <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mb-1">Wadarta Isticmaalayaasha</p>
              <p className="font-mono text-2xl font-medium tabular-nums text-[#1C1917] dark:text-[#F5F2EB]">
                {users.length}
              </p>
            </div>
            <div className="bg-white dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-5">
              <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mb-1">Hadda Online ah</p>
              <p className="font-mono text-2xl font-medium tabular-nums text-[#14532D] dark:text-[#4ADE80]">
                {onlineCount}
              </p>
            </div>
            <div className="bg-white dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-5">
              <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mb-1">Maamulayaasha (Admin)</p>
              <p className="font-mono text-2xl font-medium tabular-nums text-[#1C1917] dark:text-[#F5F2EB]">
                {adminCount}
              </p>
            </div>
            <div className="bg-white dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-5">
              <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mb-1">Buugagga Maktabadda</p>
              <p className="font-mono text-2xl font-medium tabular-nums text-[#1C1917] dark:text-[#F5F2EB]">
                {totalBooksCount}
              </p>
            </div>
          </div>
        </>
      )}

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {[
            { id: 'all' as const, label: `Dhammaan (${users.length})` },
            { id: 'online' as const, label: `Online (${onlineCount})` },
            { id: 'admin' as const, label: `Admin (${adminCount})` },
            { id: 'user' as const, label: `Akhristayaal (${users.length - adminCount})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterMode(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                filterMode === tab.id
                  ? 'bg-[#14532D] dark:bg-[#15803D] border-[#14532D] dark:border-[#15803D] text-white'
                  : 'bg-white dark:bg-[#1C1B19] border-[#E5E0D5] dark:border-[#2E2C29] text-[#57534E] dark:text-[#D6D3CD] hover:text-[#1C1917] dark:hover:text-[#F5F2EB]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-[#78716C] dark:text-[#A8A29E] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="Raadi magac ama email..."
            aria-label="Raadi isticmaalayaasha"
            className="w-full pl-9 pr-3 py-2 bg-white dark:bg-[#1C1B19] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-xs text-[#1C1917] dark:text-[#F5F2EB] placeholder:text-[#A8A29E] dark:placeholder:text-[#78716C] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-sm text-[#57534E] dark:text-[#A8A29E]">
            Waa la soo dejinayaa liiska isticmaalayaasha...
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-8 text-sm text-[#57534E] dark:text-[#A8A29E]">
            {users.length === 0
              ? 'Weli isticmaale kale isma diiwaangelin.'
              : 'Isticmaale u dhigma raadintaada lama helin.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E5E0D5] dark:border-[#2E2C29] bg-[#F8F6F1] dark:bg-[#161514] text-xs font-medium text-[#57534E] dark:text-[#A8A29E]">
                  <th className="py-3 px-4">Magaca</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Doorka</th>
                  <th className="py-3 px-4">Favorites</th>
                  <th className="py-3 px-4">Xaaladda</th>
                  <th className="py-3 px-4">Last Seen</th>
                  <th className="py-3 px-4 text-right">Maamul</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFECE5] dark:divide-[#2E2C29] text-sm">
                {filteredUsers.map((u) => {
                  const isSelf = u.uid === currentAdminUid;
                  return (
                    <tr
                      key={u.uid}
                      className="hover:bg-[#F8F6F1]/60 dark:hover:bg-[#242320] transition-colors"
                    >
                      <td className="py-3 px-4 font-medium text-[#1C1917] dark:text-[#F5F2EB] whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <UserAvatar
                            src={u.avatarUrl}
                            name={u.name}
                            sizeClass="w-7 h-7"
                            textClass="text-[10px]"
                          />
                          <span>{u.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-[#57534E] dark:text-[#A8A29E] font-mono text-xs whitespace-nowrap">
                        {u.email}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                            u.role === 'admin'
                              ? 'text-[#92400E] dark:text-[#FBBF24]'
                              : 'text-[#57534E] dark:text-[#A8A29E]'
                          }`}
                        >
                          {u.role === 'admin' ? (
                            <Shield className="w-3.5 h-3.5" />
                          ) : (
                            <UserCheck className="w-3.5 h-3.5" />
                          )}
                          {u.role === 'admin' ? 'Admin' : 'Reader'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-[#1C1917] dark:text-[#F5F2EB]">
                        {Array.isArray(u.favorites) ? u.favorites.length : 0}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`text-xs font-medium ${
                            u.presence.online
                              ? 'text-[#14532D] dark:text-[#4ADE80]'
                              : 'text-[#78716C] dark:text-[#A8A29E]'
                          }`}
                        >
                          {u.presence.online ? 'Online' : 'Offline'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-[#78716C] dark:text-[#A8A29E] whitespace-nowrap">
                        {u.presence.online
                          ? 'Hadda firfircoon'
                          : formatLastSeen(u.presence.lastSeen)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {isSelf ? (
                          <span className="text-xs text-[#78716C] dark:text-[#A8A29E]">Adiga</span>
                        ) : (
                          <button
                            type="button"
                            disabled={updatingUid === u.uid}
                            onClick={() => handleToggleRole(u)}
                            className="text-xs font-medium text-[#14532D] dark:text-[#4ADE80] hover:underline disabled:opacity-50"
                          >
                            {u.role === 'admin' ? 'Ka dhig Reader' : 'Ka dhig Admin'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

