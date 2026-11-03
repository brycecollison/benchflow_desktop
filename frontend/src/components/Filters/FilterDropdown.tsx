import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  X,
  Check,
  Search,
  Ban,
  SlidersHorizontal,
} from 'lucide-react';

export interface FilterOption {
  id: string;
  label: string;
  color?: string;
  count?: number;
  archived?: boolean;
}

interface FilterDropdownProps {
  title: string;
  icon?: React.ReactNode;
  options: FilterOption[];
  selectedValues: string[];
  isNot: boolean;
  onToggleValue: (id: string) => void;
  onSetValues: (values: string[]) => void;
  onToggleNot: () => void;
  onClear: () => void;
  align?: 'auto' | 'left' | 'right';
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

export const FilterDropdown: React.FC<FilterDropdownProps> = ({
  title,
  icon,
  options,
  selectedValues,
  isNot,
  onToggleValue,
  onSetValues,
  onToggleNot,
  onClear,
  align = 'auto',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const handleClose = () => {
    setIsOpen(false);
    setSearchQuery('');
  };

  const updatePosition = () => {
    if (!containerRef.current) return;
    const buttonRect = containerRef.current.getBoundingClientRect();

    // Find the enclosing main element (flowchart area) or viewport
    const mainEl = containerRef.current.closest('main') || document.body;
    const mainRect = mainEl.getBoundingClientRect();

    const idealWidth = 288; // 18rem / w-72
    const margin = 8;

    // Boundaries of the flowchart area (strictly preventing spillover behind the sidebar)
    const minX = mainRect.left + margin;
    const maxX = mainRect.right - margin;
    const availableWidth = Math.max(180, maxX - minX);
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
      // 'auto' mode: prefer aligning with left of button if it fits to the right, otherwise align right
      if (buttonRect.left + popoverWidth <= maxX && buttonRect.left >= minX) {
        targetLeft = buttonRect.left;
      } else if (buttonRect.right - popoverWidth >= minX) {
        targetLeft = buttonRect.right - popoverWidth;
      } else {
        targetLeft = Math.max(minX, Math.min(buttonRect.left, maxX - popoverWidth));
      }
    }

    // Relative to containerRef
    const relativeLeft = targetLeft - buttonRect.left;

    setPopoverStyle({
      left: `${relativeLeft}px`,
      right: 'auto',
      width: `${popoverWidth}px`,
      maxWidth: `${availableWidth}px`,
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

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
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

  // Focus search input when opening
  useEffect(() => {
    if (isOpen && options.length >= 6) {
      const timer = setTimeout(() => searchInputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, options.length]);

  const hasSelection = selectedValues.length > 0;

  // Filter options by search query
  const filteredOptions = searchQuery.trim()
    ? options.filter((opt) =>
        opt.label.toLowerCase().includes(searchQuery.toLowerCase().trim())
      )
    : options;

  // Generate trigger button display label
  const getTriggerLabel = () => {
    if (!hasSelection) {
      return `All`;
    }
    if (selectedValues.length === 1) {
      const opt = options.find((o) => o.id === selectedValues[0]);
      return opt ? opt.label : selectedValues[0];
    }
    if (selectedValues.length === options.length && options.length > 1) {
      return `All (${options.length})`;
    }
    return `${selectedValues.length} selected`;
  };

  const selectedOptionFirst =
    selectedValues.length === 1
      ? options.find((o) => o.id === selectedValues[0])
      : null;

  return (
    <div
      className={`relative inline-block text-left ${isOpen ? 'z-50' : 'z-10'}`}
      ref={containerRef}
    >
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`text-xs py-1 px-2.5 rounded-lg border flex items-center gap-1.5 transition-all select-none shadow-xs ${
          hasSelection
            ? isNot
              ? 'border-rose-500/50 bg-rose-500/10 text-rose-800 dark:text-rose-200 font-medium hover:bg-rose-500/15'
              : 'border-[var(--acc)] bg-[var(--sel)] text-[var(--acc)] font-medium hover:bg-[var(--sel)]/80'
            : 'border-[var(--line)] bg-[var(--card)] text-[var(--ink)] hover:border-[var(--acc)]/60'
        }`}
        title={`${title} Filter: ${
          hasSelection
            ? isNot
              ? `NOT (${getTriggerLabel()})`
              : getTriggerLabel()
            : 'All'
        }`}
      >
        {icon && <span className="opacity-70">{icon}</span>}
        <span className="font-semibold text-[var(--mut)]">{title}:</span>

        {/* NOT badge on trigger button when NOT mode is active */}
        {hasSelection && isNot && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onToggleNot();
            }}
            title="Click to toggle between NOT (Exclude) and IS (Include) mode"
            className="px-1.5 py-0.2 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-600 hover:bg-rose-700 text-white shadow-xs cursor-pointer transition-colors"
          >
            NOT
          </span>
        )}

        {/* Single item color dot if only 1 is selected */}
        {selectedOptionFirst?.color && (
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: selectedOptionFirst.color }}
          />
        )}

        <span className="truncate max-w-[120px] font-medium">
          {getTriggerLabel()}
        </span>

        {/* Clear button if has active selection */}
        {hasSelection && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            title="Clear this filter"
            className="p-0.5 -mr-1 rounded-full hover:bg-black/10 dark:hover:bg-white/20 text-[var(--mut)] hover:text-red-500 transition-colors"
          >
            <X size={11} />
          </span>
        )}

        <ChevronDown
          size={12}
          className={`transition-transform opacity-60 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown Popover */}
      {isOpen && (
        <div
          ref={popoverRef}
          style={popoverStyle}
          className="absolute mt-1.5 rounded-xl bg-[var(--card)] border border-[var(--line)] shadow-xl z-50 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100"
        >
          {/* Header */}
          <div className="p-3 border-b border-[var(--line)] space-y-2.5 bg-black/[0.02] dark:bg-white/[0.02]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wide text-[var(--ink)] flex items-center gap-1.5">
                <SlidersHorizontal size={13} className="text-[var(--acc)]" />
                <span>{title} Filter</span>
              </span>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-md text-[var(--mut)] hover:text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10 border-none bg-transparent"
                title="Close"
              >
                <X size={13} />
              </button>
            </div>

            {/* Segmented Mode Control: IS vs NOT */}
            <div className="flex items-center p-0.5 rounded-lg bg-black/10 dark:bg-black/30 border border-[var(--line)] text-xs font-medium">
              <button
                type="button"
                onClick={() => {
                  if (isNot) onToggleNot();
                }}
                className={`flex-1 py-1.5 px-2 rounded-md transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer border-none ${
                  !isNot
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
                  if (!isNot) onToggleNot();
                }}
                className={`flex-1 py-1.5 px-2 rounded-md transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer border-none ${
                  isNot
                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-sm font-bold ring-1 ring-rose-400/40'
                    : 'text-[var(--mut)] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 bg-transparent'
                }`}
              >
                <Ban size={12} strokeWidth={2.5} />
                <span>NOT (Exclude)</span>
              </button>
            </div>

            {/* Mode Explanatory Notice */}
            <div
              className={`text-[11px] px-2.5 py-1.5 rounded-md flex items-center gap-2 transition-colors font-medium border ${
                isNot
                  ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30'
                  : 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 border-emerald-500/30'
              }`}
            >
              {isNot ? (
                <>
                  <Ban size={12} className="shrink-0 text-rose-600 dark:text-rose-400" />
                  <span>Excluding experiments matching selected</span>
                </>
              ) : (
                <>
                  <Check size={12} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>Showing experiments matching selected</span>
                </>
              )}
            </div>

            {/* Search Input if many options */}
            {options.length >= 6 && (
              <div className="relative">
                <Search
                  size={13}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--mut)] pointer-events-none"
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder={`Search ${title.toLowerCase()}...`}
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
          </div>

          {/* Quick Actions Row */}
          <div className="px-3 py-1.5 bg-black/[0.01] dark:bg-white/[0.01] border-b border-[var(--line)]/50 flex items-center justify-between text-[11px] text-[var(--mut)]">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSetValues(options.map((o) => o.id))}
                className="hover:text-[var(--ink)] hover:underline border-none bg-transparent !p-0 cursor-pointer"
              >
                Select all
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={onClear}
                className="hover:text-red-500 hover:underline border-none bg-transparent !p-0 cursor-pointer"
              >
                Clear
              </button>
            </div>

            <span className="font-mono">
              {selectedValues.length} of {options.length}
            </span>
          </div>

          {/* Options List */}
          <div className="max-h-56 overflow-y-auto divide-y divide-[var(--line)]/20 p-1">
            {filteredOptions.length === 0 ? (
              <div className="p-3 text-center text-xs text-[var(--mut)] italic">
                No matching options
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = selectedValues.includes(opt.id);

                return (
                  <div
                    key={opt.id}
                    onClick={() => onToggleValue(opt.id)}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-all text-xs select-none border my-0.5 ${
                      isSelected
                        ? isNot
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
                            ? isNot
                              ? 'bg-rose-600 border border-rose-600 text-white'
                              : 'bg-emerald-600 border border-emerald-600 text-white'
                            : 'border border-[var(--line)] bg-[var(--card)]'
                        }`}
                      >
                        {isSelected && (
                          isNot ? <X size={11} strokeWidth={3} /> : <Check size={11} strokeWidth={3} />
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
                          <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400 opacity-80">
                            [Archived]
                          </span>
                        )}
                      </span>
                    </div>

                    {/* Count badge */}
                    {opt.count != null && (
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono shrink-0 ${
                          isSelected
                            ? isNot
                              ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
                              : 'bg-[var(--acc)]/20 text-[var(--acc)]'
                            : 'bg-black/5 dark:bg-white/10 text-[var(--mut)]'
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

          {/* Footer */}
          <div className="p-2 border-t border-[var(--line)] bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-between">
            <span className="text-[11px] text-[var(--mut)] truncate">
              {hasSelection
                ? isNot
                  ? `${selectedValues.length} excluded`
                  : `${selectedValues.length} selected`
                : 'No filter active'}
            </span>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-xs px-2.5 py-1 rounded-md bg-[var(--acc)] text-white hover:opacity-90 font-medium"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
