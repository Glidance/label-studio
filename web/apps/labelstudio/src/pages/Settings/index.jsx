import { ABILITY, useAuth } from "@humansignal/core/providers/AuthProvider";
import { SidebarMenu } from "../../components/SidebarMenu/SidebarMenu";
import { WebhookPage } from "../WebhookPage/WebhookPage";
import { DangerZone } from "./DangerZone";
import { GeneralSettings } from "./GeneralSettings";
import { AnnotationSettings } from "./AnnotationSettings";
import { LabelingSettings } from "./LabelingSettings";
import { MachineLearningSettings } from "./MachineLearningSettings/MachineLearningSettings";
import { PredictionsSettings } from "./PredictionsSettings/PredictionsSettings";
import { StorageSettings } from "./StorageSettings/StorageSettings";
import "./settings.scss";

export const MenuLayout = ({ children, ...routeProps }) => {
  const { permissions } = useAuth();
  const canViewStorage = permissions.can(ABILITY.can_view_storage);
  const canAccessDangerZone = permissions.can(ABILITY.can_access_danger_zone);

  return (
    <SidebarMenu
      menuItems={[
        GeneralSettings,
        LabelingSettings,
        AnnotationSettings,
        MachineLearningSettings,
        PredictionsSettings,
        canViewStorage && StorageSettings,
        WebhookPage,
        canAccessDangerZone && DangerZone,
      ].filter(Boolean)}
      path={routeProps.match.url}
      children={children}
    />
  );
};

const pages = {
  AnnotationSettings,
  LabelingSettings,
  MachineLearningSettings,
  PredictionsSettings,
  StorageSettings,
  WebhookPage,
  DangerZone,
};

export const SettingsPage = {
  title: "Settings",
  path: "/settings",
  exact: true,
  layout: MenuLayout,
  component: GeneralSettings,
  pages,
};
