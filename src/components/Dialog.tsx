import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18n';
import { btnDanger, btnPrimary, btnSecondary, field, label as labelCls } from './ui';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Larger panel for forms with more content. */
  wide?: boolean;
}

/** Accessible modal built on the native <dialog> element (focus trap, Esc and inert background come for free). */
export function Dialog({ open, title, onClose, children, wide }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- backdrop click is a mouse convenience; Esc (onCancel) is the keyboard path
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`m-auto w-[calc(100%-2rem)] ${wide ? 'max-w-xl' : 'max-w-md'} rounded-2xl border border-line bg-surface p-0 text-fg shadow-2xl`}
    >
      {open && (
        <div className="p-6">
          <h2 id={titleId} className="font-display text-2xl font-semibold leading-tight">
            {title}
          </h2>
          <div className="mt-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={props.open} title={props.title} onClose={props.onCancel}>
      <p className="text-muted">{props.message}</p>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button type="button" className={btnSecondary} onClick={props.onCancel} data-autofocus>
          {t('common.cancel')}
        </button>
        <button type="button" className={props.danger ? btnDanger : btnPrimary} onClick={props.onConfirm}>
          {props.confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

export function GuideFormDialog(props: {
  open: boolean;
  title: string;
  submitLabel: string;
  initialTitle?: string;
  initialDescription?: string;
  withDescription?: boolean;
  maxTitle: number;
  maxDescription: number;
  onSubmit: (v: { title: string; description: string }) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(props.initialTitle ?? '');
  const [description, setDescription] = useState(props.initialDescription ?? '');
  const [touched, setTouched] = useState(false);
  const titleId = useId();
  const descId = useId();

  // Start from the initial values each time the dialog is OPENED (closed -> open, or other initial values
  // arriving while it is open). This is done while rendering, not in an effect: an effect runs after the
  // commit, so it could overwrite what the user had already typed into the freshly shown field.
  const [seen, setSeen] = useState({ open: props.open, t: props.initialTitle, d: props.initialDescription });
  if (seen.open !== props.open || seen.t !== props.initialTitle || seen.d !== props.initialDescription) {
    setSeen({ open: props.open, t: props.initialTitle, d: props.initialDescription });
    if (props.open) {
      setTitle(props.initialTitle ?? '');
      setDescription(props.initialDescription ?? '');
      setTouched(false);
    }
  }

  const invalid = title.trim().length === 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid) return;
    props.onSubmit({ title: title.trim(), description: description.trim() });
  };

  return (
    <Dialog open={props.open} title={props.title} onClose={props.onCancel} wide>
      <form onSubmit={submit} noValidate>
        <label htmlFor={titleId} className={labelCls}>
          {t('guide.nameLabel')}
        </label>
        <input
          id={titleId}
          className={field}
          value={title}
          maxLength={props.maxTitle}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('guide.namePlaceholder')}
          aria-invalid={touched && invalid}
          aria-describedby={touched && invalid ? `${titleId}-err` : undefined}
          dir="auto"
          data-autofocus
        />
        {touched && invalid && (
          <p id={`${titleId}-err`} className="mt-1.5 text-sm font-medium text-danger" role="alert">
            {t('guide.nameRequired')}
          </p>
        )}
        {props.withDescription && (
          <div className="mt-4">
            <label htmlFor={descId} className={labelCls}>
              {t('guide.descriptionLabel')}
            </label>
            <textarea
              id={descId}
              className={`${field} min-h-24 resize-y`}
              value={description}
              maxLength={props.maxDescription}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('guide.descriptionPlaceholder')}
              dir="auto"
            />
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button type="button" className={btnSecondary} onClick={props.onCancel}>
            {t('common.cancel')}
          </button>
          <button type="submit" className={btnPrimary}>
            {props.submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}