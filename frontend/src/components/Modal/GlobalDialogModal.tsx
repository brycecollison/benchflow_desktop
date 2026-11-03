import React, { useState, useEffect, useRef } from 'react';
import { useDialogStore } from '../../store/useDialogStore';
import {
  AlertTriangle,
  AlertCircle,
  HelpCircle,
  Info,
  X,
  Check,
  ChevronDown,
} from 'lucide-react';

export const GlobalDialogModal: React.FC = () => {
  const { activeDialog, closeDialog } = useDialogStore();
  const [inputValue, setInputValue] = useState('');
  const [selectValue, setSelectValue] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeDialog?.type === 'prompt') {
      const initial = activeDialog.options.defaultValue ?? '';
      setInputValue(initial);
      setSelectValue(
        activeDialog.options.defaultSelectValue ??
          activeDialog.options.selectOptions?.[0]?.value ??
          ''
      );

      const initialFields: Record<string, string> = {};
      if (activeDialog.options.selectFields) {
        for (const f of activeDialog.options.selectFields) {
          initialFields[f.id] = f.defaultValue ?? f.options[0]?.value ?? '';
        }
      }
      setFieldValues(initialFields);

      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 50);
    }
  }, [activeDialog]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!activeDialog) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeDialog, closeDialog]);

  if (!activeDialog) return null;

  const { type, options } = activeDialog;
  const variant = options.variant || (type === 'alert' ? 'info' : 'default');

  const handleConfirm = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (type === 'confirm') {
      activeDialog.resolve(true);
    } else if (type === 'prompt') {
      if (options.selectFields && options.selectFields.length > 0) {
        activeDialog.resolve({
          value: inputValue,
          selectValue: options.selectFields[0] ? fieldValues[options.selectFields[0].id] : '',
          fieldValues,
        });
      } else if (options.selectOptions && options.selectOptions.length > 0) {
        activeDialog.resolve({
          value: inputValue,
          selectValue: selectValue,
          fieldValues: { [options.selectLabel || 'select']: selectValue },
        });
      } else {
        activeDialog.resolve(inputValue);
      }
    } else if (type === 'alert') {
      activeDialog.resolve();
    }
  };

  const handleCancel = () => {
    closeDialog();
  };

  // Determine header icon and accent styling
  let icon = <Info size={20} className="text-[var(--acc)]" />;
  let iconBg = 'bg-[var(--acc)]/10 border-[var(--acc)]/20';
  let primaryBtnClass =
    'bg-[var(--acc)] hover:opacity-90 text-white shadow-sm';

  if (variant === 'danger') {
    icon = <AlertTriangle size={20} className="text-rose-500" />;
    iconBg = 'bg-rose-500/10 border-rose-500/20';
    primaryBtnClass = 'bg-rose-600 hover:bg-rose-700 text-white shadow-sm';
  } else if (variant === 'warning') {
    icon = <AlertCircle size={20} className="text-amber-500" />;
    iconBg = 'bg-amber-500/10 border-amber-500/20';
    primaryBtnClass = 'bg-amber-600 hover:bg-amber-700 text-white shadow-sm';
  } else if (type === 'prompt') {
    icon = <HelpCircle size={20} className="text-[var(--acc)]" />;
    iconBg = 'bg-[var(--acc)]/10 border-[var(--acc)]/20';
  }

  const confirmLabel =
    options.confirmLabel ||
    (type === 'confirm'
      ? variant === 'danger'
        ? 'Delete'
        : 'Confirm'
      : type === 'prompt'
      ? 'OK'
      : 'Got it');

  const cancelLabel =
    (type === 'confirm' || type === 'prompt') &&
    'cancelLabel' in options &&
    options.cancelLabel
      ? options.cancelLabel
      : 'Cancel';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-[var(--card)] border border-[var(--line)] rounded-xl shadow-2xl max-w-md w-full overflow-hidden text-[var(--ink)] animate-in zoom-in-95 duration-150 flex flex-col">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 flex items-start gap-3.5">
          <div
            className={`w-10 h-10 rounded-full border flex items-center justify-center shrink-0 ${iconBg}`}
          >
            {icon}
          </div>
          <div className="flex-1 min-w-0 pr-4">
            <h3 className="text-base font-semibold text-[var(--ink)] leading-snug">
              {options.title}
            </h3>
            {type !== 'prompt' && 'message' in options && options.message && (
              <p className="mt-1 text-sm text-[var(--mut)] leading-relaxed whitespace-pre-line">
                {options.message}
              </p>
            )}
            {type === 'prompt' && options.message && (
              <p className="mt-1 text-xs text-[var(--mut)] leading-relaxed">
                {options.message}
              </p>
            )}
          </div>
          <button
            onClick={handleCancel}
            type="button"
            className="!p-1 text-[var(--mut)] hover:text-[var(--ink)] rounded-md hover:bg-black/5 dark:hover:bg-white/5 border-none bg-transparent transition-colors -mr-1 -mt-1"
            title="Close (Esc)"
          >
            <X size={17} />
          </button>
        </div>

        {/* Prompt Input Form */}
        {type === 'prompt' ? (
          <form onSubmit={handleConfirm} className="px-5 py-2 flex flex-col gap-3.5">
            <div>
              {options.inputLabel && (
                <label className="block text-xs font-medium text-[var(--mut)] mb-1.5">
                  {options.inputLabel}
                </label>
              )}
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={options.placeholder || ''}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--line)] bg-[var(--bg)] text-[var(--ink)] placeholder:text-[var(--mut)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--acc)]/30 focus:border-[var(--acc)] transition-all shadow-inner"
              />
            </div>

            {/* Multiple select fields layout */}
            {options.selectFields && options.selectFields.length > 0 ? (
              <div className="flex flex-col gap-3">
                {/* Status & Priority in 2-column grid if present */}
                {options.selectFields.some((f) => f.id === 'status' || f.id === 'priority') && (
                  <div className="grid grid-cols-2 gap-3">
                    {options.selectFields
                      .filter((f) => f.id === 'status' || f.id === 'priority')
                      .map((field) => (
                        <div key={field.id}>
                          <label className="block text-xs font-medium text-[var(--mut)] mb-1.5">
                            {field.label}
                          </label>
                          <div className="relative">
                            <select
                              value={fieldValues[field.id] ?? field.defaultValue ?? ''}
                              onChange={(e) =>
                                setFieldValues((prev) => ({
                                  ...prev,
                                  [field.id]: e.target.value,
                                }))
                              }
                              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--line)] bg-[var(--bg)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--acc)]/30 focus:border-[var(--acc)] transition-all cursor-pointer appearance-none pr-8 font-medium"
                            >
                              {field.options.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                            <ChevronDown
                              size={14}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--mut)] pointer-events-none"
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                )}

                {/* Other fields (e.g. Paper) as full width */}
                {options.selectFields
                  .filter((f) => !f.multi && f.id !== 'status' && f.id !== 'priority')
                  .map((field) => (
                    <div key={field.id}>
                      <label className="block text-xs font-medium text-[var(--mut)] mb-1.5">
                        {field.label}
                      </label>
                      <div className="relative">
                        <select
                          value={fieldValues[field.id] ?? field.defaultValue ?? ''}
                          onChange={(e) =>
                            setFieldValues((prev) => ({
                              ...prev,
                              [field.id]: e.target.value,
                            }))
                          }
                          className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--line)] bg-[var(--bg)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--acc)]/30 focus:border-[var(--acc)] transition-all cursor-pointer appearance-none pr-8 font-medium"
                        >
                          {field.options.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={14}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--mut)] pointer-events-none"
                        />
                      </div>
                    </div>
                  ))}

                {/* Multi-select fields as toggle chips (e.g. Phases) */}
                {options.selectFields
                  .filter((f) => f.multi)
                  .map((field) => {
                    const selected = (fieldValues[field.id] ?? field.defaultValue ?? '')
                      .split(',')
                      .filter(Boolean);
                    return (
                      <div key={field.id}>
                        <label className="block text-xs font-medium text-[var(--mut)] mb-1.5">
                          {field.label}
                        </label>
                        <div className="flex items-center gap-2 flex-wrap">
                          {field.options.map((opt) => {
                            const isOn = selected.includes(opt.value);
                            return (
                              <label
                                key={opt.value}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer select-none transition-colors ${
                                  isOn
                                    ? 'border-[var(--acc)] bg-[var(--acc)]/10 text-[var(--ink)] shadow-2xs'
                                    : 'border-[var(--line)] bg-[var(--bg)] text-[var(--mut)] hover:text-[var(--ink)] hover:border-[var(--acc)]'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isOn}
                                  onChange={() =>
                                    setFieldValues((prev) => {
                                      const cur = (prev[field.id] ?? field.defaultValue ?? '')
                                        .split(',')
                                        .filter(Boolean);
                                      const next = isOn
                                        ? cur.filter((v) => v !== opt.value)
                                        : [...cur, opt.value];
                                      return { ...prev, [field.id]: next.join(',') };
                                    })
                                  }
                                  className="rounded text-[var(--acc)] focus:ring-[var(--acc)] cursor-pointer w-3.5 h-3.5"
                                />
                                <span>{opt.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              options.selectOptions &&
              options.selectOptions.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-[var(--mut)] mb-1.5">
                    {options.selectLabel || 'Paper'}
                  </label>
                  <div className="relative">
                    <select
                      value={selectValue}
                      onChange={(e) => setSelectValue(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--line)] bg-[var(--bg)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--acc)]/30 focus:border-[var(--acc)] transition-all cursor-pointer appearance-none pr-8 font-medium"
                    >
                      {options.selectOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={14}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--mut)] pointer-events-none"
                    />
                  </div>
                </div>
              )
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--line)]/50 pb-1">
              <button
                type="button"
                onClick={handleCancel}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--line)] text-[var(--mut)] hover:text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors bg-transparent"
              >
                {cancelLabel}
              </button>
              <button
                type="submit"
                disabled={options.required !== false && !inputValue.trim()}
                className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 ${primaryBtnClass} ${
                  options.required !== false && !inputValue.trim()
                    ? 'opacity-50 cursor-not-allowed'
                    : ''
                }`}
              >
                <Check size={14} />
                <span>{confirmLabel}</span>
              </button>
            </div>
          </form>
        ) : (
          /* Confirm or Alert Footer */
          <div className="px-5 py-3 mt-1 bg-black/[0.02] dark:bg-white/[0.02] border-t border-[var(--line)]/50 flex items-center justify-end gap-2">
            {type === 'confirm' && (
              <button
                type="button"
                onClick={handleCancel}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--line)] text-[var(--mut)] hover:text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors bg-transparent"
              >
                {cancelLabel}
              </button>
            )}
            <button
              type="button"
              onClick={() => handleConfirm()}
              autoFocus
              className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 ${primaryBtnClass}`}
            >
              <span>{confirmLabel}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
