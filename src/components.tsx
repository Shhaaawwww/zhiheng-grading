import {
  useEffect,
  useRef,
  useId,
  Children,
  cloneElement,
  isValidElement,
  type ReactNode,
} from "react";
import {
  X,
  LoaderCircle,
  ArrowUpRight,
  Info,
  FolderOpen,
  ChevronRight,
} from "lucide-react";
import { fmt, pct } from "./api";
export function Button({
  children,
  variant = "primary",
  busy = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      className={`btn ${variant} ${props.className || ""}`}
      disabled={busy || props.disabled}
    >
      {busy && <LoaderCircle size={16} className="spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-title">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-btn" aria-label="关闭对话框" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  let assigned = false;
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {Children.map(children, (child) => {
        if (
          !assigned &&
          isValidElement<Record<string, unknown>>(child) &&
          ["input", "textarea", "select"].includes(String(child.type))
        ) {
          assigned = true;
          return cloneElement(child, {
            id,
            "aria-describedby": hint
              ? id + "-hint"
              : child.props["aria-describedby"],
          });
        }
        return child;
      })}
      {hint && <small id={id + "-hint"}>{hint}</small>}
    </div>
  );
}
export function Empty({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <FolderOpen size={30} strokeWidth={1.3} />
      </div>
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
      {children}
    </div>
  );
}
export function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warn" | "success";
}) {
  return (
    <div className={`notice ${tone}`}>
      <Info size={16} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
export function ErrorBox({ error }: { error: string }) {
  return error ? (
    <div className="error-box" role="alert">
      {error}
    </div>
  ) : null;
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
export function Metric({
  title,
  value,
  unit,
  detail,
  icon,
}: {
  title: string;
  value: string;
  unit?: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <article className="metric">
      <div className="metric-label">
        {title}
        <span className="metric-icon">{icon}</span>
      </div>
      <div className="metric-value">
        {value}
        <span>{unit}</span>
      </div>
      <div className="metric-detail">{detail}</div>
    </article>
  );
}
export function RateBar({
  label,
  value,
  detail,
  onClick,
  tone,
}: {
  label: string;
  value: number | null;
  detail?: string;
  onClick?: () => void;
  tone?: string;
}) {
  const contents = (
    <>
      <div className="bar-label">
        <span>{label}</span>
        <strong>{pct(value)}</strong>
      </div>
      <div className="bar-track">
        <div
          className={tone || ((value ?? 0) < 50 ? "amber" : "teal")}
          style={{ width: `${value ?? 0}%` }}
        />
      </div>
      {detail && <small>{detail}</small>}
    </>
  );
  return onClick ? (
    <button className="rate-row clickable" onClick={onClick}>
      {contents}
    </button>
  ) : (
    <div className="rate-row">{contents}</div>
  );
}
export function ActionLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="action-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
}
export function StepCard({
  number,
  title,
  detail,
  onClick,
  done = false,
}: {
  number: string;
  title: string;
  detail: string;
  onClick: () => void;
  done?: boolean;
}) {
  return (
    <button className={`step-card ${done ? "done" : ""}`} onClick={onClick}>
      <span className="step-number">{number}</span>
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <ChevronRight size={17} />
    </button>
  );
}
export function Distribution({
  data,
}: {
  data: { label: string; count: number }[];
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div
      className="histogram"
      role="img"
      aria-label={data.map((d) => `${d.label}得分率：${d.count}人`).join("；")}
    >
      {data.map((d, i) => (
        <div className="hist-column" key={d.label}>
          <span>{d.count}</span>
          <div className="hist-space">
            <div
              className={`hist-bar h${i}`}
              style={{
                height: `${(d.count / max) * 100}%`,
                minHeight: d.count ? 8 : 2,
              }}
            />
          </div>
          <small>{d.label}</small>
        </div>
      ))}
    </div>
  );
}
export function Completion({ value, total }: { value: number; total: number }) {
  return (
    <div className="completion">
      <div>
        <span>已确认成绩</span>
        <strong>
          {value}
          <em> / {total}</em>
        </strong>
      </div>
      <div className="bar-track">
        <div
          className="teal"
          style={{ width: `${total ? (value / total) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}
