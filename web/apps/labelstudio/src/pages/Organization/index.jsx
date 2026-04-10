import { Redirect } from "react-router-dom";
import { ABILITY, useAuth } from "@humansignal/core/providers/AuthProvider";
import { SidebarMenu } from "../../components/SidebarMenu/SidebarMenu";
import { PeoplePage } from "./PeoplePage/PeoplePage";
import { WebhookPage } from "../WebhookPage/WebhookPage";

const ALLOW_ORGANIZATION_WEBHOOKS = window.APP_SETTINGS.flags?.allow_organization_webhooks;

const MenuLayout = ({ children, ...routeProps }) => {
  const menuItems = [PeoplePage];

  if (ALLOW_ORGANIZATION_WEBHOOKS) {
    menuItems.push(WebhookPage);
  }
  return <SidebarMenu menuItems={menuItems} path={routeProps.match.url} children={children} />;
};

const organizationPages = {};

if (ALLOW_ORGANIZATION_WEBHOOKS) {
  organizationPages[WebhookPage] = WebhookPage;
}

// Page-level guard: non-glidance users who navigate directly to /organization
// are bounced back to /projects. UX guardrail, not a security boundary — see
// docs/superpowers/specs/2026-04-10-glidance-account-restrictions-design.md
// § "Backend follow-up".
const GatedPeoplePage = (props) => {
  const { permissions, isLoading } = useAuth();
  if (isLoading) return null;
  if (!permissions.can(ABILITY.can_access_organization)) {
    return <Redirect to="/projects" />;
  }
  return <PeoplePage {...props} />;
};

export const OrganizationPage = {
  title: "Organization",
  path: "/organization",
  exact: true,
  layout: MenuLayout,
  component: GatedPeoplePage,
  pages: organizationPages,
};
