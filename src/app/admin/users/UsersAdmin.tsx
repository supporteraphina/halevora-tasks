"use client";

import { useActionState } from "react";
import {
  createUserAction,
  renameUserAction,
  resetPasswordAction,
  setRoleAction,
  type AdminState,
} from "./actions";
import styles from "./admin.module.css";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: "CEO" | "MEMBER";
  timezone: string;
}

const empty: AdminState = {};

function Banner({ state }: { state: AdminState }) {
  if (state.error) {
    return (
      <p className={styles.error} role="alert">
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p className={styles.ok} role="status">
        {state.ok}
      </p>
    );
  }
  return null;
}

function CreateUser() {
  const [state, action, pending] = useActionState(createUserAction, empty);
  return (
    <section className={styles.panel} aria-labelledby="add-heading">
      <h2 id="add-heading" className={styles.panelTitle}>
        Add a member
      </h2>
      <form action={action} className={styles.createForm}>
        <div className={styles.grid}>
          <label className={styles.field}>
            <span className={styles.label}>Name</span>
            <input className={styles.input} name="name" required placeholder="Full name" />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Email</span>
            <input
              className={styles.input}
              name="email"
              type="email"
              required
              placeholder="name@halevora.com"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Role</span>
            <select className={styles.input} name="role" defaultValue="MEMBER">
              <option value="MEMBER">Member</option>
              <option value="CEO">CEO</option>
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Temporary password</span>
            <input
              className={styles.input}
              name="password"
              type="text"
              required
              minLength={6}
              placeholder="At least 6 characters"
            />
          </label>
        </div>
        <div className={styles.createActions}>
          <Banner state={state} />
          <button type="submit" className={styles.primaryBtn} disabled={pending}>
            {pending ? "Adding…" : "Add member"}
          </button>
        </div>
      </form>
    </section>
  );
}

function RoleControl({ user, isSelf }: { user: UserRow; isSelf: boolean }) {
  const [state, action, pending] = useActionState(setRoleAction, empty);
  return (
    <form action={action} className={styles.inline}>
      <input type="hidden" name="id" value={user.id} />
      <select
        className={styles.roleSelect}
        name="role"
        defaultValue={user.role}
        aria-label={`Role for ${user.name}`}
        disabled={pending}
      >
        <option value="MEMBER">Member</option>
        <option value="CEO">CEO</option>
      </select>
      <button type="submit" className={styles.ghostBtn} disabled={pending}>
        Save
      </button>
      {isSelf ? <span className={styles.selfTag}>You</span> : null}
      <Banner state={state} />
    </form>
  );
}

function RenameControl({ user }: { user: UserRow }) {
  const [state, action, pending] = useActionState(renameUserAction, empty);
  return (
    <form action={action} className={styles.inline}>
      <input type="hidden" name="id" value={user.id} />
      <input
        className={styles.inlineInput}
        name="name"
        defaultValue={user.name}
        aria-label={`Name for ${user.email}`}
        disabled={pending}
      />
      <button type="submit" className={styles.ghostBtn} disabled={pending}>
        Rename
      </button>
      <Banner state={state} />
    </form>
  );
}

function ResetPassword({ user }: { user: UserRow }) {
  const [state, action, pending] = useActionState(resetPasswordAction, empty);
  return (
    <form action={action} className={styles.inline}>
      <input type="hidden" name="id" value={user.id} />
      <input
        className={styles.inlineInput}
        name="password"
        type="text"
        minLength={6}
        placeholder="New password"
        aria-label={`New password for ${user.name}`}
        disabled={pending}
      />
      <button type="submit" className={styles.ghostBtn} disabled={pending}>
        Reset
      </button>
      <Banner state={state} />
    </form>
  );
}

export default function UsersAdmin({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string;
}) {
  return (
    <div className={styles.stack}>
      <CreateUser />

      <section className={styles.panel} aria-labelledby="list-heading">
        <h2 id="list-heading" className={styles.panelTitle}>
          {users.length} {users.length === 1 ? "member" : "members"}
        </h2>
        <ul className={styles.list}>
          {users.map((user) => (
            <li key={user.id} className={styles.row}>
              <div className={styles.identity}>
                <span className={styles.avatar} aria-hidden="true">
                  {user.name.trim().charAt(0).toUpperCase() || "?"}
                </span>
                <span className={styles.who}>
                  <span className={styles.name}>{user.name}</span>
                  <span className={styles.email}>{user.email}</span>
                </span>
              </div>
              <div className={styles.controls}>
                <RenameControl user={user} />
                <RoleControl user={user} isSelf={user.id === currentUserId} />
                <ResetPassword user={user} />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
