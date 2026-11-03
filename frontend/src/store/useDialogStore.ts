import { create } from 'zustand';

export type DialogVariant = 'default' | 'danger' | 'warning' | 'info';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: DialogVariant;
}

export interface PromptSelectOption {
  value: string;
  label: string;
  color?: string;
}

export interface PromptSelectField {
  id: string;
  label: string;
  options: PromptSelectOption[];
  defaultValue?: string;
  /** Render as checkbox chips (multi-select). Value in fieldValues is comma-joined option values. */
  multi?: boolean;
}

export interface PromptDialogOptions {
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: DialogVariant;
  required?: boolean;
  inputLabel?: string;
  selectLabel?: string;
  selectOptions?: PromptSelectOption[];
  defaultSelectValue?: string;
  selectFields?: PromptSelectField[];
}

export interface PromptResult {
  value: string;
  selectValue?: string;
  fieldValues?: Record<string, string>;
}

export interface AlertDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: DialogVariant;
}

export type ActiveDialog =
  | {
      id: string;
      type: 'confirm';
      options: ConfirmDialogOptions;
      resolve: (value: boolean) => void;
    }
  | {
      id: string;
      type: 'prompt';
      options: PromptDialogOptions;
      resolve: (value: any) => void;
    }
  | {
      id: string;
      type: 'alert';
      options: AlertDialogOptions;
      resolve: () => void;
    }
  | null;

interface DialogStoreState {
  activeDialog: ActiveDialog;
  openConfirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  openPrompt: (options: PromptDialogOptions) => Promise<string | null>;
  openPromptSelect: (options: PromptDialogOptions) => Promise<PromptResult | null>;
  openAlert: (options: AlertDialogOptions) => Promise<void>;
  closeDialog: () => void;
}

export const useDialogStore = create<DialogStoreState>((set, get) => ({
  activeDialog: null,

  openConfirm: (options: ConfirmDialogOptions) => {
    return new Promise<boolean>((resolve) => {
      set({
        activeDialog: {
          id: Math.random().toString(36).substring(2),
          type: 'confirm',
          options,
          resolve: (result: boolean) => {
            set({ activeDialog: null });
            resolve(result);
          },
        },
      });
    });
  },

  openPrompt: (options: PromptDialogOptions) => {
    return new Promise<string | null>((resolve) => {
      set({
        activeDialog: {
          id: Math.random().toString(36).substring(2),
          type: 'prompt',
          options,
          resolve: (result: any) => {
            set({ activeDialog: null });
            if (typeof result === 'object' && result !== null && 'value' in result) {
              resolve(result.value);
            } else {
              resolve(result);
            }
          },
        },
      });
    });
  },

  openPromptSelect: (options: PromptDialogOptions) => {
    return new Promise<PromptResult | null>((resolve) => {
      set({
        activeDialog: {
          id: Math.random().toString(36).substring(2),
          type: 'prompt',
          options,
          resolve: (result: any) => {
            set({ activeDialog: null });
            if (result === null) {
              resolve(null);
            } else if (typeof result === 'object' && result !== null && 'value' in result) {
              resolve(result as PromptResult);
            } else {
              const defaultFieldValues: Record<string, string> = {};
              if (options.selectFields) {
                for (const f of options.selectFields) {
                  defaultFieldValues[f.id] = f.defaultValue || f.options[0]?.value || '';
                }
              }
              resolve({
                value: String(result),
                selectValue:
                  options.defaultSelectValue ||
                  options.selectOptions?.[0]?.value ||
                  '',
                fieldValues: defaultFieldValues,
              });
            }
          },
        },
      });
    });
  },

  openAlert: (options: AlertDialogOptions) => {
    return new Promise<void>((resolve) => {
      set({
        activeDialog: {
          id: Math.random().toString(36).substring(2),
          type: 'alert',
          options,
          resolve: () => {
            set({ activeDialog: null });
            resolve();
          },
        },
      });
    });
  },

  closeDialog: () => {
    const current = get().activeDialog;
    if (current) {
      if (current.type === 'confirm') {
        current.resolve(false);
      } else if (current.type === 'prompt') {
        current.resolve(null);
      } else if (current.type === 'alert') {
        current.resolve();
      }
    }
    set({ activeDialog: null });
  },
}));

// Ergonomic helpers that can be imported and invoked anywhere:
export const confirmDialog = (options: ConfirmDialogOptions) =>
  useDialogStore.getState().openConfirm(options);

export const promptDialog = (options: PromptDialogOptions) =>
  useDialogStore.getState().openPrompt(options);

export const promptSelectDialog = (options: PromptDialogOptions) =>
  useDialogStore.getState().openPromptSelect(options);

export const alertDialog = (options: AlertDialogOptions) =>
  useDialogStore.getState().openAlert(options);
