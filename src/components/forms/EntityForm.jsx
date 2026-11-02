// Schema-driven form on react-hook-form + zod. Most add/edit dialogs in the app are this
// component plus a list of field definitions, so validation behaves the same everywhere.
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import clsx from 'clsx';
import { Modal, Drawer } from '../ui/index.jsx';

/** field: { name, label, type?, options?, required?, min?, max?, placeholder?, full?, help?, email? } */
export function buildSchema(fields) {
  const shape = {};
  fields.forEach((f) => {
    if (f.type === 'checkbox') {
      shape[f.name] = z.boolean().optional();
    } else if (f.type === 'number') {
      let n = z.coerce.number({ invalid_type_error: `${f.label} must be a number` });
      if (f.min !== undefined) n = n.min(f.min, `${f.label} must be at least ${f.min}`);
      if (f.max !== undefined) n = n.max(f.max, `${f.label} must be at most ${f.max}`);
      // An untouched optional number arrives as '' and should stay empty, not become 0.
      shape[f.name] = f.required
        ? z.preprocess((v) => (v === '' || v === null || v === undefined ? NaN : v), z.coerce.number({ invalid_type_error: `${f.label} is required` }).pipe(n))
        : z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), n.optional());
    } else {
      let s = z.string({ required_error: `${f.label} is required` }).trim();
      if (f.required) s = s.min(1, `${f.label} is required`);
      // Format checks skip blank values: emptiness is the "required" rule's job.
      if (f.email) s = s.refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address');
      if (f.pattern) s = s.refine((v) => !v || f.pattern.test(v), f.patternMessage || `${f.label} is not valid`);
      shape[f.name] = s;
    }
  });
  return z.object(shape);
}

export const opt = (o) => (typeof o === 'string' ? { value: o, label: o } : o);

export function FieldError({ message }) {
  if (!message) return null;
  return <p role="alert" className="mt-1 text-xs font-medium text-danger">{message}</p>;
}

export function FieldRow({ field, register, error }) {
  const id = `f-${field.name}`;
  const cls = clsx('input', error && 'input-error');
  const a11y = { id, 'aria-invalid': !!error, disabled: field.disabled };
  if (field.type === 'checkbox') {
    return (
      <label htmlFor={id} className="flex items-center gap-2 pt-5 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-primary-hover" {...a11y} {...register(field.name)} />
        {field.label}
      </label>
    );
  }
  return (
    <div>
      <label htmlFor={id} className="label">{field.label}{field.required && <span className="text-danger"> *</span>}</label>
      {field.type === 'select' && (
        <select className={cls} {...a11y} {...register(field.name)}>
          {!field.required && <option value="">-</option>}
          {field.required && <option value="">Select...</option>}
          {field.options.map(opt).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {field.type === 'textarea' && <textarea rows={field.rows || 3} className={cls} placeholder={field.placeholder} {...a11y} {...register(field.name)} />}
      {!['select', 'textarea'].includes(field.type) && (
        <input type={field.type === 'number' ? 'number' : field.type || 'text'} step={field.type === 'number' ? field.step || 'any' : undefined} className={cls} placeholder={field.placeholder} {...a11y} {...register(field.name)} />
      )}
      {field.help && !error && <p className="mt-1 text-xs text-ink-muted">{field.help}</p>}
      <FieldError message={error?.message} />
    </div>
  );
}

const blankFor = (f) => (f.type === 'checkbox' ? false : '');

export function EntityForm({ fields, defaultValues, onSubmit, formId, schema, columns = 2 }) {
  const resolver = useMemo(() => zodResolver(schema || buildSchema(fields)), [fields, schema]);
  const initial = () => Object.fromEntries(fields.map((f) => [f.name, defaultValues?.[f.name] ?? f.default ?? blankFor(f)]));
  const { register, handleSubmit, reset, formState: { errors } } = useForm({ resolver, defaultValues: initial() });
  // Re-seed when the dialog opens for a different record.
  const seedKey = JSON.stringify(defaultValues ?? null); // by value: callers pass inline objects
  useEffect(() => { reset(initial()); /* eslint-disable-next-line */ }, [seedKey]);
  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} noValidate className={clsx('grid gap-3', columns === 2 && 'sm:grid-cols-2')}>
      {fields.map((f) => (
        <div key={f.name} className={clsx(f.full && 'sm:col-span-2')}>
          <FieldRow field={f} register={register} error={errors[f.name]} />
        </div>
      ))}
    </form>
  );
}

/** Modal (or Drawer) wrapping an EntityForm with Save / Cancel. */
export function FormModal({ open, onClose, title, fields, defaultValues, onSubmit, submitLabel = 'Save', size = 'md', drawer, schema, extra }) {
  const formId = useMemo(() => `form-${Math.random().toString(36).slice(2, 8)}`, []);
  const Shell = drawer ? Drawer : Modal;
  return (
    <Shell
      open={open}
      onClose={onClose}
      title={title}
      size={size}
      footer={(
        <>
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
          <button type="submit" form={formId} className="btn-primary">{submitLabel}</button>
        </>
      )}
    >
      {open && <EntityForm formId={formId} fields={fields} defaultValues={defaultValues} onSubmit={onSubmit} schema={schema} />}
      {extra}
    </Shell>
  );
}
