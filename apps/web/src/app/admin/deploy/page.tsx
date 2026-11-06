import { redirect } from 'next/navigation';

// The old restart button (Docker socket) was removed; release and health live on /admin/system.
export default function AdminDeployRedirect() {
  redirect('/admin/system');
}
