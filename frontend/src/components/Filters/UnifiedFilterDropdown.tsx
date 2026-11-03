import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  SlidersHorizontal,
  ChevronDown,
  X,
  Check,
  Search,
  Ban,
  RotateCcw,
} from 'lucide-react';
import type { FilterOption } from './FilterDropdown';

export interface FilterCategoryConfig {
  id: string;
  title: string;
  icon?: React.ReactNode;
  options: FilterOption[];
  selectedValues: string[];
  isNot: boolean;
  onToggleValue: (id: string) => void;
  onSetValues: (values: string[]) => void;
  onToggleNot: () => void;
  onClear: () => void;
}

interface UnifiedFilterDropdownProps {
  categories: FilterCategoryConfig[];
  onResetAll: () => void;
  align?: 'auto' | 'left' | 'right';
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

export const UnifiedFilterDropdown: React.FC<UnifiedFilterDropdownProps> = ({
  categories,
  onResetAll,
  align = 'auto',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTabId, setActiveTabId] = useState<string>(categories[0]?.id || 'status');
  const [searchQuery, setSearchQuery] = useState('');
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Guarantee valid active tab id
  const currentTabId =
    categories.find((c) => c.id === activeTabId)?.id ||
    categories[0]?.id ||
    'status';

  // Active category
  const activeCategory =
    categories.find((c) => c.id === currentTabId) || categories[0];

  const totalActiveCount = categories.reduce(
    (sum, cat) => sum + cat.selectedValues.length,
    0
  );

  const hasAnyNot = categories.some(
    (cat) => cat.selectedValues.length > 0 && cat.isNot
  );

  const handleClose = () => {
    setIsOpen(false);
    setSearchQuery('');
  };

  const updatePosition = () => {
    if (!containerRef.current) return;
    const buttonRect = containerRef.current.getBoundingClientRect();

    const idealWidth = 320;
    const margin = 8;

    const minX = margin;
    const maxX = window.innerWidth - margin;
    const availableWidth = Math.max(220, maxX - minX);
    const popoverWidth = Math.min(idealWidth, availableWidth);

    let targetLeft: number;

    if (align === 'right') {
      const idealLeft = buttonRect.right - popoverWidth;
      if (idealLeft >= minX) {
        targetLeft = Math.min(idealLeft, maxX - popoverWidth);
      } else {
        targetLeft = Math.max(minX, Math.min(buttonRect.left, maxX - popoverWidth));
      }
    } else if (align === 'left') {
      const idealLeft = buttonRect.left;
      if (idealLeft + popoverWidth <= maxX) {
        targetLeft = Math.max(minX, idealLeft);
      } else {
        targetLeft = Math.max(minX, maxX - popoverWidth);
      }
    } else {
      // auto: align right if close to right edge, else left
      if (buttonRect.left + popoverWidth <= maxX && buttonRect.left >= minX) {
        targetLeft = buttonRect.left;
      } else if (buttonRect.right - popoverWidth >= minX) {
        targetLeft = buttonRect.right - popoverWidth;
      } else {
        targetLeft = Math.max(minX, Math.min(buttonRect.left, maxX - popoverWidth));
      }
    }

    setPopoverStyle({
      position: 'fixed',
      top: `${buttonRect.bottom + 6}px`,
      left: `${targetLeft}px`,
      width: `${popoverWidth}px`,
      maxWidth: `${availableWidth}px`,
      maxHeight: `calc(100vh - ${buttonRect.bottom + 16}px)`,
      zIndex: 9999,
    });
  };

  useIsomorphicLayoutEffect(() => {
    if (isOpen) {
      updatePosition();
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);
      return () => {
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition, true);
      };
    }
  }, [isOpen, align]);

  // Click outside to close (checking both container and portaled popover)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        handleClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Clear search on tab switch
  const handleTabChange = (tabId: string) => {
    setActiveTabId(tabId);
    setSearchQuery('');
  };

  // Filter options for the active category
  const filteredOptions = activeCategory
    ? searchQuery.trim()
      ? activeCategory.options.filter((opt) =>
          opt.label.toLowerCase().includes(searchQuery.toLowerCase().trim())
        )
      : activeCategory.options
    : [];

  return (
    <div
      className={`relative inline-block text-left ${isOpen ? 'z-50' : 'z-10'}`}
      ref={containerRef}
    >
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`text-xs py-1 px-2.5 rounded-lg border flex items-center gap-1.5 transition-all select-none shadow-xs cursor-pointer ${
          totalActiveCount > 0
            ? hasAnyNot
              ? 'border-rose-500/60 bg-rose-500/15 text-rose-800 dark:text-rose-200 font-semibold hover:bg-rose-500/20'
              : 'border-emerald-500/60 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 font-semibold hover:bg-emerald-500/20'
            : 'border-[var(--line)] bg-[var(--card)] text-[var(--ink)] hover:border-[var(--acc)]/60 hover:bg-[var(--sel)]/40'
        }`}
        title={
          totalActiveCount > 0
            ? `${totalActiveCount} filter${totalActiveCount > 1 ? 's' : ''} active`
            : 'Filter experiments'
        }
      >
        <SlidersHorizontal
          size={13}
          className={
            totalActiveCount > 0
              ? hasAnyNot
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-emerald-600 dark:text-emerald-400'
              : 'text-[var(--mut)]'
          }
        />
        <span className="font-semibold">Filters</span>

        {/* Count badge */}
        {totalActiveCount > 0 && (
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              hasAnyNot ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'
            }`}
          >
            {totalActiveCount}
          </span>
        )}

        {/* NOT badge indicator if any is active */}
        {hasAnyNot && (
          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider bg-rose-600 text-white shadow-2xs">
            NOT
          </span>
        )}

        {/* Quick Reset Button if active */}
        {totalActiveCount > 0 && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onResetAll();
            }}
            title="Reset all filters"
            className="p-0.5 -mr-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/20 text-[var(--mut)] hover:text-red-500 transition-colors cursor-pointer"
          >
            <X size={11} />
          </span>
        )}

        <ChevronDown
          size={12}
          className={`transition-transform opacity-60 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Popover rendered via Portal into document.body */}
      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            style={popoverStyle}
            className="rounded-xl bg-[var(--card)] border border-[var(--line)] shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100"
          >
          {/* Header */}
          <div className="p-2.5 border-b border-[var(--line)] bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink)]">
              <SlidersHorizontal size={13} className="text-[var(--acc)]" />
              <span>Flowchart Filters</span>
              {totalActiveCount > 0 && (
                <span className="text-[11px] font-normal text-[var(--mut)]">
                  ({totalActiveCount} active)
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {totalActiveCount > 0 && (
                <button
                  type="button"
                  onClick={onResetAll}
                  className="text-[11px] px-1.5 py-0.5 rounded text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-1 border-none bg-transparent cursor-pointer"
                  title="Clear all active filters"
                >
                  <RotateCcw size={11} />
                  <span>Reset all</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleClose}
                className="p-1 rounded-md text-[var(--mut)] hover:text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10 border-none bg-transparent cursor-pointer"
                title="Close"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {/* Category Tabs */}
          <div className="flex border-b border-[var(--line)] bg-black/[0.04] dark:bg-black/20 p-1.5 gap-1.5">
            {categories.map((cat) => {
              const isActive = cat.id === currentTabId;
              const selCount = cat.selectedValues.length;

              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleTabChange(cat.id)}
                  className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer border ${
                    isActive
                      ? cat.isNot
                        ? 'bg-rose-600 text-white border-rose-500 shadow-sm font-bold ring-2 ring-rose-400/40'
                        : 'bg-emerald-600 text-white border-emerald-500 shadow-sm font-bold ring-2 ring-emerald-400/40'
                      : 'border-[var(--line)]/60 bg-black/5 dark:bg-white/5 text-[var(--mut)] hover:text-[var(--ink)] hover:bg-black/10 dark:hover:bg-white/10 font-medium'
                  }`}
                >
                  <span>{cat.title}</span>
                  {selCount > 0 && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                        isActive
                          ? 'bg-white/25 text-white'
                          : cat.isNot
                            ? 'bg-rose-600 text-white'
                            : 'bg-emerald-600 text-white'
                      }`}
                    >
                      {selCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Active Category Content */}
          {activeCategory && (
            <div className="p-3 space-y-2.5">
              {/* IS vs NOT Segmented Control */}
              <div className="flex items-center p-0.5 rounded-lg bg-black/10 dark:bg-black/30 border border-[var(--line)] text-xs font-medium">
                <button
                  type="button"
                  onClick={() => {
                    if (activeCategory.isNot) activeCategory.onToggleNot();
                  }}
                  className={`flex-1 py-1.5 px-2 rounded-md transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer border-none ${
                    !activeCategory.isNot
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm font-bold ring-1 ring-emerald-400/40'
                      : 'text-[var(--mut)] hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-500/10 bg-transparent'
                  }`}
                >
                  <Check size={12} strokeWidth={2.5} />
                  <span>IS (Include)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!activeCategory.isNot) activeCategory.onToggleNot();
                  }}
                  className={`flex-1 py-1.5 px-2 rounded-md transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer border-none ${
                    activeCategory.isNot
                      ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-sm font-bold ring-1 ring-rose-400/40'
                      : 'text-[var(--mut)] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 bg-transparent'
                  }`}
                >
                  <Ban size={12} strokeWidth={2.5} />
                  <span>NOT (Exclude)</span>
                </button>
              </div>

              {/* Search input with guaranteed padding */}
              {activeCategory.options.length >= 5 && (
                <div className="relative">
                  <Search
                    size={13}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--mut)] pointer-events-none"
                  />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder={`Search ${activeCategory.title.toLowerCase()}...`}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ paddingLeft: '32px', paddingRight: '28px' }}
                    className="w-full text-xs !pl-8 !pr-7 py-1.5 rounded-md bg-[var(--card)] border border-[var(--line)] focus:outline-hidden focus:border-[var(--acc)] text-[var(--ink)] placeholder:text-[var(--mut)]"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--mut)] hover:text-[var(--ink)] border-none bg-transparent !p-0 cursor-pointer"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              )}

              {/* Quick Actions Row */}
              <div className="pt-1 flex items-center justify-between text-[11px] text-[var(--mut)]">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      activeCategory.onSetValues(
                        activeCategory.options.map((o) => o.id)
                      )
                    }
                    className="hover:text-[var(--ink)] hover:underline border-none bg-transparent !p-0 cursor-pointer"
                  >
                    Select all
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={activeCategory.onClear}
                    className="hover:text-red-500 hover:underline border-none bg-transparent !p-0 cursor-pointer"
                  >
                    Clear
                  </button>
                </div>

                <span className="font-mono text-[10px]">
                  {activeCategory.selectedValues.length} of {activeCategory.options.length}
                </span>
              </div>

              {/* Options List */}
              <div className="max-h-52 overflow-y-auto divide-y divide-[var(--line)]/20 border border-[var(--line)]/40 rounded-lg p-0.5">
                {filteredOptions.length === 0 ? (
                  <div className="p-3 text-center text-xs text-[var(--mut)] italic">
                    No matching options
                  </div>
                ) : (
                  filteredOptions.map((opt) => {
                    const isSelected = activeCategory.selectedValues.includes(opt.id);

                    return (
                      <div
                        key={opt.id}
                        onClick={() => activeCategory.onToggleValue(opt.id)}
                        className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-all text-xs select-none border my-0.5 ${
                          isSelected
                            ? activeCategory.isNot
                              ? 'bg-rose-500/15 dark:bg-rose-500/25 border-rose-500/50 text-rose-900 dark:text-rose-100 font-semibold shadow-2xs'
                              : 'bg-emerald-500/15 dark:bg-emerald-500/25 border-emerald-500/50 text-emerald-950 dark:text-emerald-100 font-semibold shadow-2xs'
                            : 'border-transparent hover:bg-black/5 dark:hover:bg-white/5 text-[var(--ink)]'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate pr-2">
                          {/* Checkbox indicator */}
                          <span
                            className={`w-4 h-4 rounded flex items-center justify-center transition-colors shrink-0 shadow-2xs ${
                              isSelected
                                ? activeCategory.isNot
                                  ? 'bg-rose-600 border border-rose-600 text-white'
                                  : 'bg-emerald-600 border border-emerald-600 text-white'
                                : 'border border-[var(--line)] bg-[var(--card)]'
                            }`}
                          >
                            {isSelected && (
                              activeCategory.isNot ? (
                                <X size={11} strokeWidth={3} />
                              ) : (
                                <Check size={11} strokeWidth={3} />
                              )
                            )}
                          </span>

                          {/* Color dot if available */}
                          {opt.color ? (
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs"
                              style={{ backgroundColor: opt.color }}
                            />
                          ) : opt.id === '-' ? (
                            <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-dashed border-[var(--mut)]" />
                          ) : null}

                          <span className="truncate">
                            {opt.label}
                            {opt.archived && (
                              <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400 opacity-80 font-normal">
                                [Archived]
                              </span>
                            )}
                          </span>
                        </div>

                        {/* Count Badge */}
                        {typeof opt.count === 'number' && (
                          <span
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full shrink-0 ${
                              isSelected
                                ? activeCategory.isNot
                                  ? 'bg-rose-500/30 text-rose-900 dark:text-rose-100 font-bold border border-rose-500/40'
                                  : 'bg-emerald-500/30 text-emerald-950 dark:text-emerald-100 font-bold border border-emerald-500/40'
                                : 'bg-black/5 dark:bg-white/5 text-[var(--mut)]'
                            }`}
                          >
                            {opt.count}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Footer Active Summary */}
          {totalActiveCount > 0 && (
            <div className="px-3 py-2 border-t border-[var(--line)] bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-between text-[11px]">
              <span className="text-[var(--mut)]">
                {totalActiveCount} filter{totalActiveCount > 1 ? 's' : ''} applied
              </span>
              <button
                type="button"
                onClick={onResetAll}
                className="text-red-600 dark:text-red-400 hover:underline border-none bg-transparent !p-0 cursor-pointer font-medium"
              >
                Clear all filters
              </button>
            </div>
          )}
          </div>,
          document.body
        )}
    </div>
  );
};
