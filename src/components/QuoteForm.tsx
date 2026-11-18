"use client";

import { useEffect, useRef, useState } from "react";

export interface QuoteFields {
  name: string;
  phone: string;
  email: string;
  service: string;
  address: string;
  preferred_date: string;
  home_size: string;
  notes: string;
}

export const EMPTY_QUOTE: QuoteFields = {
  name: "",
  phone: "",
  email: "",
  service: "",
  address: "",
  preferred_date: "",
  home_size: "",
  notes: "",
};

const SERVICES = [
  "Recurring Cleaning",
  "Deep Cleaning",
  "Move-In / Move-Out Cleaning",
  "Commercial Cleaning",
  "Special Event Cleaning",
  "Home Care Cleaning",
  "Other / Not sure",
];

function validate(f: QuoteFields): Partial<Record<keyof QuoteFields, string>> {
  const e: Partial<Record<keyof QuoteFields, string>> = {};
  if (!f.name.trim()) e.name = "Name is required";
  if (f.phone.trim() && f.phone.replace(/\D/g, "").length < 7) e.phone = "Enter a valid phone number";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = "Enter a valid email";
  if (!f.service) e.service = "Choose a service";
  if (!f.address.trim()) e.address = "Address is required";
  return e;
}

export default function QuoteForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: QuoteFields;
  onSubmit: (f: QuoteFields) => Promise<{ ok: boolean; error?: string; fieldErrors?: Record<string, string> }>;
  onCancel: () => void;
}) {
  const [f, setF] = useState<QuoteFields>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof QuoteFields, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    ref.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);

  const set = (k: keyof QuoteFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setF((p) => ({ ...p, [k]: e.target.value }));
    if (errors[k]) setErrors((p) => ({ ...p, [k]: undefined }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validate(f);
    setErrors(v);
    if (Object.keys(v).length) {
      setFormError("Please fill in all required fields.");
      return;
    }
    setFormError(null);
    setSubmitting(true);
    const res = await onSubmit(f);
    setSubmitting(false);
    if (!res.ok) {
      setErrors((res.fieldErrors ?? {}) as Partial<Record<keyof QuoteFields, string>>);
      setFormError(res.error ?? "Something went wrong. Please try again.");
    }
  };

  const input =
    "w-full rounded-lg border bg-white px-3 py-2 text-[14px] outline-none focus:border-orange focus:ring-2 focus:ring-orange/20";
  const field = (k: keyof QuoteFields) => `${input} ${errors[k] ? "border-red-400" : "border-black/10"}`;
  const label = "mb-1 block text-[12px] font-medium text-ink";
  const err = (k: keyof QuoteFields) =>
    errors[k] ? <p className="mt-0.5 text-[11.5px] text-red-600">{errors[k]}</p> : null;
  const req = <span className="text-red-500">*</span>;
  const opt = <span className="font-normal text-muted">(optional)</span>;

  return (
    <form
      ref={ref}
      onSubmit={submit}
      noValidate
      className="w-full max-w-[92%] rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand/15"
      aria-label="Get a quote form"
    >
      <div className="mb-0.5 text-[11px] font-bold uppercase tracking-[2px] text-orange">Free quote</div>
      <div className="mb-1 text-[16px] font-semibold text-navy">Get your free quote</div>
      <p className="mb-3 text-[12.5px] text-muted">
        Fill in your details so the SHINENOS team can prepare your quote. Fields marked {req} are required.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={label} htmlFor="q-name">Full name {req}</label>
          <input id="q-name" className={field("name")} value={f.name} onChange={set("name")} autoComplete="name" maxLength={120} />
          {err("name")}
        </div>
        <div>
          <label className={label} htmlFor="q-phone">Phone {opt}</label>
          <input id="q-phone" className={field("phone")} value={f.phone} onChange={set("phone")} type="tel" autoComplete="tel" maxLength={40} />
          {err("phone")}
        </div>
        <div>
          <label className={label} htmlFor="q-email">Email {req}</label>
          <input id="q-email" className={field("email")} value={f.email} onChange={set("email")} type="email" autoComplete="email" maxLength={200} />
          {err("email")}
        </div>
        <div>
          <label className={label} htmlFor="q-service">Service {req}</label>
          <select id="q-service" className={field("service")} value={f.service} onChange={set("service")}>
            <option value="">Select a service…</option>
            {SERVICES.map((s) => (
              <option key={s}>{s}</option>
            ))}
            {f.service && !SERVICES.includes(f.service) && <option>{f.service}</option>}
          </select>
          {err("service")}
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="q-address">Address {req}</label>
          <input
            id="q-address"
            className={field("address")}
            value={f.address}
            onChange={set("address")}
            autoComplete="street-address"
            placeholder="Street, city, ZIP"
            maxLength={300}
          />
          {err("address")}
        </div>
        <div>
          <label className={label} htmlFor="q-date">Preferred date {opt}</label>
          <input id="q-date" className={field("preferred_date")} value={f.preferred_date} onChange={set("preferred_date")} placeholder="e.g. next Friday" maxLength={120} />
        </div>
        <div>
          <label className={label} htmlFor="q-size">Home size {opt}</label>
          <input id="q-size" className={field("home_size")} value={f.home_size} onChange={set("home_size")} placeholder="e.g. 3 bed, 2 bath" maxLength={200} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="q-notes">Anything else? Pets, special requests {opt}</label>
          <textarea id="q-notes" className={`${field("notes")} resize-none`} rows={2} value={f.notes} onChange={set("notes")} maxLength={2000} />
        </div>
      </div>

      {formError && <p className="mt-3 text-[12.5px] font-medium text-red-600" role="alert">{formError}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(0,38,115,.25)] hover:bg-navy disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit quote request"}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting} className="rounded-xl px-3 py-2 text-sm font-medium text-muted hover:bg-black/5">
          Not now
        </button>
      </div>
    </form>
  );
}
