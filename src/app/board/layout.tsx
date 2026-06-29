/**
 * Board layout with a `@modal` parallel slot. The intercepting route
 * `@modal/(.)task/[id]` renders the task detail panel over the board (keeping board
 * context) for in-app navigation; a hard load of `/board/task/[id]` falls through to the
 * full-page route instead. `@modal/default.tsx` renders nothing when no task is open.
 */
export default function BoardLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
