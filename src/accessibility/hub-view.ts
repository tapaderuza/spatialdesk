export type HubPage = 'home' | 'fit' | 'input' | 'sound' | 'vision' | 'communication' | 'steps' | 'tasks' | 'consultation' | 'memory' | 'help' | 'clinical' | 'privacy' | 'library' | 'share' | 'energy';

export interface HubAction {
  key: string;
  label: string;
  detail?: string;
  disabled?: boolean;
  run: () => void | Promise<void>;
}

export interface HubField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'password' | 'date' | 'datetime-local' | 'select';
  value?: string;
  required?: boolean;
  maxLength?: number;
  options?: { value: string; label: string }[];
}

export interface HubForm {
  id: string;
  title: string;
  description?: string;
  fields: HubField[];
  submitLabel: string;
  submit: (values: Record<string, string>) => void | Promise<void>;
}

export interface HubView {
  owner?: 'hub' | 'agent';
  isOpen: boolean;
  page: HubPage;
  title: string;
  summary: string;
  notice: string;
  items: HubAction[];
  forms: HubForm[];
  pageIndex: number;
  pageCount: number;
  caption: string;
  progress?: { completed: number; skipped: number; total: number };
}

export interface HubPresenter {
  getView(): HubView;
  subscribe(listener: () => void): () => void;
  open(page?: HubPage): void;
  close(): void;
  nextPage(): void;
  back(): void;
}
