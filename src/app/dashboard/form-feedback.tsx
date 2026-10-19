import type { FormState } from "@/app/dashboard/bookings/actions";

/** The success / form-level error line under a dashboard form. */
export function Feedback({ state, id }: { state: FormState; id?: string }) {
  if (state.status === "ok") {
    return (
      <p role="status" className="text-sm text-mpesa">
        {state.message}
      </p>
    );
  }
  if (state.status === "error" && state.errors._form) {
    return (
      <p id={id} className="field-error" role="alert">
        {state.errors._form}
      </p>
    );
  }
  return null;
}

export function FieldError({ id, message }: { id: string; message?: string | undefined }) {
  return message ? (
    <p id={id} className="field-error">
      {message}
    </p>
  ) : null;
}
