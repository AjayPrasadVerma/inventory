"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/misc";

export interface AppUser {
  id: number;
  name: string;
  mobile: string;
  role: "owner" | "staff";
  is_active: boolean;
  created_at: string;
}

/**
 * Add or edit a login.
 *
 * The mobile number is the login name, so it is asked for on both add and edit.
 * The password is only on the add form: changing an existing one is its own
 * action, so that renaming somebody cannot quietly reset how they sign in.
 */
export function UserForm({
  user,
  onClose,
  onSaved,
}: {
  user: AppUser | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const editing = !!user;
  const [name, setName] = useState(user?.name ?? "");
  const [mobile, setMobile] = useState(user?.mobile ?? "");
  const [role, setRole] = useState<"owner" | "staff">(user?.role ?? "staff");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Enter a name";
    if (!/^\d{7,15}$/.test(mobile.trim())) e.mobile = "Enter a valid mobile number";
    if (!editing && password.length < 8) e.password = "At least 8 characters";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    try {
      if (editing) {
        await api(`/auth/users/${user!.id}`, {
          method: "PATCH",
          body: { name: name.trim(), mobile: mobile.trim(), role },
        });
        toast("User updated", "success");
      } else {
        await api("/auth/users", {
          method: "POST",
          body: { name: name.trim(), mobile: mobile.trim(), role, password },
        });
        toast(`${name.trim()} can now sign in`, "success");
      }
      onSaved();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? "Edit user" : "Add user"}
      footer={(close) => (
        <>
          <Button variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Spinner /> : editing ? "Save" : "Add user"}</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <Field label="Name" htmlFor="u-name" error={errors.name}>
          <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)}
                 invalid={!!errors.name} placeholder="Full name" autoFocus />
        </Field>

        <Field
          label="Mobile number"
          htmlFor="u-mobile"
          error={errors.mobile}
          hint="This is what they type to sign in."
        >
          <Input id="u-mobile" value={mobile} inputMode="numeric"
                 onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
                 invalid={!!errors.mobile} placeholder="10-digit number" />
        </Field>

        <Field
          label="Role"
          htmlFor="u-role"
          hint="Owners can manage users and delete records. Staff can do everything else."
        >
          <Select id="u-role" value={role} onChange={(e) => setRole(e.target.value as "owner" | "staff")}>
            <option value="staff">Staff</option>
            <option value="owner">Owner</option>
          </Select>
        </Field>

        {!editing && (
          <Field
            label="Password"
            htmlFor="u-password"
            error={errors.password}
            hint="At least 8 characters. Tell it to them — the app cannot send it."
          >
            <Input id="u-password" type="text" value={password}
                   onChange={(e) => setPassword(e.target.value)}
                   invalid={!!errors.password} placeholder="Set a password" />
          </Field>
        )}
      </div>
    </Modal>
  );
}

/** Set someone's password. Separate from the edit form on purpose — see above. */
export function PasswordForm({
  user,
  onClose,
  onSaved,
}: {
  user: AppUser;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (password.length < 8) {
      setError("At least 8 characters");
      return;
    }
    setSaving(true);
    try {
      await api(`/auth/users/${user.id}/password`, { method: "POST", body: { password } });
      toast(`Password changed for ${user.name}`, "success");
      onSaved();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Change password — ${user.name}`}
      footer={(close) => (
        <>
          <Button variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Spinner /> : "Change password"}</Button>
        </>
      )}
    >
      <Field
        label="New password"
        htmlFor="u-newpass"
        error={error}
        hint="Shown as you type so you can read it out. They can sign in with it straight away."
      >
        <Input id="u-newpass" type="text" value={password} autoFocus
               onChange={(e) => { setPassword(e.target.value); setError(""); }}
               invalid={!!error} placeholder="At least 8 characters" />
      </Field>
    </Modal>
  );
}
