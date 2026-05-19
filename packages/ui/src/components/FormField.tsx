import * as React from 'react';

/**
 * FormField — light-mode form input wrapper for admin.myclash.fr.
 *
 * Tournament Manual aesthetic:
 *   • Label in small caps eyebrow style (text-[11px] uppercase tracking-[0.14em] slate-500).
 *   • Input with `border-slate-300` resting, red-800 focus ring at 30% opacity.
 *   • Optional hint in slate-500 below.
 *   • Optional error in red-700 (visually replaces hint when set).
 *
 * The label/eyebrow pairing makes form fields read like a tournament program
 * entry rather than a generic admin form. The label is the smallest text on
 * screen; the input value is the loudest.
 *
 * Three rendering modes:
 *   • Default → renders an `<input>` from props.
 *   • `multiline` → renders a `<textarea>`.
 *   • `children` prop set → wraps caller-provided control (e.g. `<select>`).
 */
type BaseProps = {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
};

type InputProps = BaseProps &
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'> & {
    multiline?: false;
    children?: undefined;
  };

type TextareaProps = BaseProps &
  Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> & {
    multiline: true;
    children?: undefined;
  };

type WrappedProps = BaseProps & {
  children: React.ReactNode;
  multiline?: undefined;
};

export type FormFieldProps = InputProps | TextareaProps | WrappedProps;

const controlClasses = [
  'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900',
  'placeholder:text-slate-400',
  'focus:outline-none focus:border-red-800 focus:ring-2 focus:ring-red-800/20',
  'disabled:bg-slate-50 disabled:text-slate-500',
].join(' ');

function isWrappedProps(props: FormFieldProps): props is WrappedProps {
  return 'children' in props && props.children !== undefined;
}

function isTextareaProps(props: FormFieldProps): props is TextareaProps {
  return (props as TextareaProps).multiline === true;
}

export const FormField: React.FC<FormFieldProps> = (props) => {
  const { label, hint, error, required, className = '' } = props;
  const fieldId = React.useId();

  return (
    <div className={['block', className].join(' ')}>
      <label
        htmlFor={fieldId}
        className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500"
      >
        {label}
        {required ? <span className="ml-1 text-red-800">*</span> : null}
      </label>
      {isWrappedProps(props) ? (
        // Caller-provided control (e.g. <select>, custom widget)
        <div className="mt-1">{props.children}</div>
      ) : isTextareaProps(props) ? (
        (() => {
          const {
            label: _l,
            hint: _h,
            error: _e,
            required: _r,
            className: _c,
            multiline: _m,
            ...rest
          } = props;
          return (
            <textarea
              id={fieldId}
              {...rest}
              aria-invalid={error ? true : undefined}
              className={[controlClasses, 'min-h-[80px] resize-y'].join(' ')}
            />
          );
        })()
      ) : (
        (() => {
          const {
            label: _l,
            hint: _h,
            error: _e,
            required: _r,
            className: _c,
            multiline: _m,
            ...rest
          } = props as InputProps;
          return (
            <input
              id={fieldId}
              {...rest}
              aria-invalid={error ? true : undefined}
              className={controlClasses}
            />
          );
        })()
      )}
      {error ? (
        <p className="mt-1 text-xs text-red-700">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
};
