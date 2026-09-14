"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, GraduationCap, LogOut, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ADMIN_MODULES, activeModule, activeNavItem, type AdminModule } from "./nav-config";
import { NavIcon } from "./nav-icons";
import { AdminHeaderTarget } from "./page-header";
import { AdminThemeToggle } from "./theme";

const menuItems = ADMIN_MODULES.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })));

export function AdminShell({ brandName, email, children }: { brandName: string; email: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const current = activeModule(pathname);
  const [collapsed, setCollapsed] = useState(false);
  const [headerTarget, setHeaderTarget] = useState<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [selectedResult, setSelectedResult] = useState(0);
  const searchDialog = useRef<HTMLDialogElement>(null);
  const mobileDialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const filtered = menuItems.filter((item) => `${item.label} ${item.group}`.includes(query.trim()));

  useEffect(() => {
    searchDialog.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selectedResult, query]);

  function openSearch() {
    mobileDialog.current?.close();
    setQuery("");
    setSelectedResult(0);
    searchDialog.current?.showModal();
    searchInput.current?.focus();
  }

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  const navigate = (href: string) => {
    searchDialog.current?.close();
    mobileDialog.current?.close();
    router.push(href);
  };

  const sidebar = (mobile = false) => (
    <Sidebar key={`${current.key}-${mobile}`} brandName={brandName} email={email} pathname={pathname} current={current}
      collapsed={!mobile && collapsed} onSearch={openSearch} onNavigate={() => mobileDialog.current?.close()}
      onClose={mobile ? () => mobileDialog.current?.close() : undefined} />
  );

  return (
    <AdminHeaderTarget.Provider value={headerTarget}>
      <div className="dash-shell" data-collapsed={collapsed || undefined}>
        <a className="dash-skip-link" href="#admin-main">본문으로 이동</a>
        <aside className="dash-sidebar-desktop">{sidebar()}</aside>
        <div className="dash-panel">
          <header className="dash-navbar">
            <button type="button" className="dash-icon-button dash-collapse-desktop" onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"} aria-expanded={!collapsed}>
              {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
            <button type="button" className="dash-icon-button dash-collapse-mobile" aria-label="메뉴 열기" onClick={() => mobileDialog.current?.showModal()}>
              <PanelLeftOpen size={18} />
            </button>
            <div className="dash-navbar-page" ref={setHeaderTarget} />
            <div className="dash-navbar-tools">
              <button type="button" className="dash-icon-button" aria-label="메뉴 검색" onClick={openSearch}><Search size={18} /></button>
              <AdminThemeToggle />
            </div>
          </header>
          <main id="admin-main" className="dash-main" tabIndex={-1}>{children}</main>
        </div>
        <dialog ref={mobileDialog} className="dash-mobile-dialog" aria-label="관리자 메뉴" onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
          {sidebar(true)}
        </dialog>
        <dialog ref={searchDialog} className="dash-search-dialog" aria-label="메뉴 검색" onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
          <div className="dash-search-field">
            <Search size={20} aria-hidden="true" />
            <input ref={searchInput} value={query} onChange={(e) => { setQuery(e.target.value); setSelectedResult(0); }}
              placeholder="메뉴 이름으로 검색…" aria-label="검색할 메뉴" role="combobox" aria-expanded="true"
              aria-controls="admin-search-results" aria-autocomplete="list"
              aria-activedescendant={filtered.length ? `admin-search-${Math.min(selectedResult, filtered.length - 1)}` : undefined}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setSelectedResult((index) => Math.max(0, Math.min(filtered.length - 1, index + (e.key === "ArrowDown" ? 1 : -1))));
                } else if (e.key === "Enter" && filtered[selectedResult]) { e.preventDefault(); navigate(filtered[selectedResult].href); }
              }} />
            <button type="button" className="dash-icon-button" aria-label="검색 닫기" onClick={() => searchDialog.current?.close()}><X size={18} /></button>
          </div>
          <div className="dash-search-results" id="admin-search-results" role="listbox" aria-label="검색 결과">
            {filtered.length ? filtered.map((item, index) => {
              const Icon = NavIcon[item.icon];
              return <button type="button" role="option" aria-selected={index === selectedResult} id={`admin-search-${index}`}
                key={item.href} onClick={() => navigate(item.href)} className="dash-search-result">
                <Icon /><span>{item.label}</span><small>{item.group}</small>
              </button>;
            }) : <p className="px-4 py-8 text-center text-sm text-muted">일치하는 메뉴가 없습니다.</p>}
          </div>
          <div className="dash-search-footer"><span>↑ ↓ 이동</span><span>Enter 열기</span><span>Esc 닫기</span></div>
        </dialog>
      </div>
    </AdminHeaderTarget.Provider>
  );
}

function Sidebar({ brandName, email, current, pathname, collapsed, onSearch, onNavigate, onClose }: {
  brandName: string; email: string; current: AdminModule; pathname: string; collapsed: boolean;
  onSearch: () => void; onNavigate: () => void; onClose?: () => void;
}) {
  const active = activeNavItem(pathname);
  return <div className="dash-sidebar" data-compact={collapsed || undefined}>
    <div className="dash-workspace">
      <Link href="/admin/dashboard" onClick={onNavigate} className="dash-workspace-link" title={brandName}>
        <span className="dash-workspace-mark"><GraduationCap size={17} aria-hidden="true" /></span>
        {!collapsed && <span className="truncate text-[13px] font-semibold">{brandName}</span>}
      </Link>
      {onClose && <button type="button" className="dash-icon-button" aria-label="메뉴 닫기" onClick={onClose}><X size={18} /></button>}
    </div>
    <div className="dash-sidebar-body">
      <button type="button" className="dash-search-trigger" onClick={onSearch} aria-label="메뉴 검색 열기" title="메뉴 검색 (⌘ K)">
        <Search size={17} />{!collapsed && <><span>메뉴 검색…</span><kbd>⌘ K</kbd></>}
      </button>
      <nav aria-label="관리자 메뉴" className="dash-navigation">
        {ADMIN_MODULES.map((group) => group.items.length === 1 || collapsed ? (
          <Link key={group.key} href={group.items[0].href} onClick={onNavigate} title={collapsed ? group.label : undefined}
            className={cn("dash-nav-link", current.key === group.key && "is-active")} aria-current={active?.href === group.items[0].href ? "page" : undefined}>
            {(() => { const Icon = NavIcon[group.items[0].icon]; return <Icon />; })()}
            {!collapsed && <span>{group.items[0].label}</span>}
          </Link>
        ) : <NavGroup key={group.key} group={group} current={current} activeHref={active?.href} onNavigate={onNavigate} />)}
      </nav>
      <div className="dash-sidebar-bottom">
        <Link href="/" target="_blank" className="dash-nav-link" title="공개 사이트 보기">
          <ArrowUpRight size={18} aria-hidden="true" />{!collapsed && <span>사이트 보기</span>}
        </Link>
        <Link href="/admin/settings" onClick={onNavigate} className="dash-nav-link" title="설정">
          <NavIcon.settings />{!collapsed && <span>설정</span>}
        </Link>
      </div>
    </div>
    <div className="dash-user">
      <span className="dash-user-avatar" aria-hidden="true">{email.charAt(0).toUpperCase()}</span>
      {!collapsed && <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{email}</p><p className="mt-0.5 text-[11px] text-muted">관리자</p></div>}
      <form action="/api/auth/logout" method="post"><button type="submit" className="dash-icon-button" aria-label="로그아웃" title="로그아웃"><LogOut size={16} /></button></form>
    </div>
  </div>;
}

function NavGroup({ group, current, activeHref, onNavigate }: { group: AdminModule; current: AdminModule; activeHref?: string; onNavigate: () => void }) {
  const [open, setOpen] = useState(group.key === current.key || (current.key === "home" && group.key === "lesson"));
  const Icon = NavIcon[group.items[0].icon];
  return <div className="dash-nav-group">
    <button type="button" className={cn("dash-nav-link", group.key === current.key && "is-current-group")} aria-expanded={open} onClick={() => setOpen(!open)}>
      <Icon /><span>{group.label}</span><ChevronDown size={14} className={cn("dash-nav-chevron", open && "is-open")} />
    </button>
    {open && <div className="dash-nav-children" role="group" aria-label={`${group.label} 메뉴`}>
      {group.items.map((item) => <Link key={item.href} href={item.href} onClick={onNavigate} className={cn("dash-nav-child", activeHref === item.href && "is-active")}
        aria-current={activeHref === item.href ? "page" : undefined}>{item.label}</Link>)}
    </div>}
  </div>;
}
