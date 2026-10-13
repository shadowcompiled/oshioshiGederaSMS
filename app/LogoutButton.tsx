/**
 * Logging out is a POST from a real button, never a <Link>.
 *
 * In production Next.js prefetches every <Link> that scrolls into view, and a
 * prefetch is an ordinary GET. With <Link href="/api/logout"> on the page, the
 * prefetch ran the logout handler the moment the admin or waiter screen
 * rendered: the session cookie was deleted behind the user's back, and their
 * next action ("מימוש", a filter, a send) came back 401 and bounced them to
 * the login page. A form submit is never prefetched.
 */
export default function LogoutButton() {
  return (
    <form method="post" action="/api/logout" className="logout-form">
      <button type="submit" className="admin-btn admin-btn-logout">
        יציאה
      </button>
    </form>
  );
}
