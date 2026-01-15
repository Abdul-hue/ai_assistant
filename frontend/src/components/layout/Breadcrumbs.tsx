import { useLocation, Link } from 'react-router-dom';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { cn } from '@/lib/utils';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

const routeLabels: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/create-agent': 'Create Agent',
  '/agent-chat': 'Agent Chat',
  '/calendar': 'Calendar',
  '/profile': 'Profile Settings',
  '/email-integration': 'Email Integration',
  '/contacts': 'Contacts',
};

export function Breadcrumbs() {
  const location = useLocation();
  const pathnames = location.pathname.split('/').filter((x) => x);

  // Don't show breadcrumbs on home/index page
  if (location.pathname === '/' || location.pathname === '/dashboard') {
    return null;
  }

  const breadcrumbItems: BreadcrumbItemType[] = [
    { label: 'Home', href: '/dashboard' },
    ...pathnames.map((pathname, index) => {
      const href = `/${pathnames.slice(0, index + 1).join('/')}`;
      const label = routeLabels[href] || pathname.charAt(0).toUpperCase() + pathname.slice(1).replace(/-/g, ' ');
      return {
        label,
        href: index < pathnames.length - 1 ? href : undefined,
      };
    }),
  ];

  return (
    <Breadcrumb className="mb-4">
      <BreadcrumbList>
        {breadcrumbItems.map((item, index) => (
          <div key={item.label} className="flex items-center">
            {index > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {item.href ? (
                <BreadcrumbLink asChild>
                  <Link to={item.href}>{item.label}</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{item.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </div>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
