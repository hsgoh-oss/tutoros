import {
  Archive, BookOpen, CalendarClock, CalendarDays, ChartNoAxesCombined,
  CircleHelp, ClipboardCheck, CreditCard, FileText, FlaskConical, Folder,
  History, House, Layers, MessageCircle, PencilLine, Send, Settings2,
  SquareCheck, Star, UserRoundPlus, UsersRound, type LucideIcon, type LucideProps,
} from "lucide-react";

function navigationIcon(Component: LucideIcon) {
  return function NavigationIcon(props: LucideProps) {
    return <Component size={18} strokeWidth={1.65} aria-hidden="true" {...props} />;
  };
}

export const NavIcon = {
  dashboard: navigationIcon(House),
  dday: navigationIcon(CalendarClock),
  recruit: navigationIcon(UserRoundPlus),
  review: navigationIcon(Star),
  faq: navigationIcon(CircleHelp),
  settings: navigationIcon(Settings2),
  consult: navigationIcon(MessageCircle),
  trial: navigationIcon(FlaskConical),
  enrollment: navigationIcon(ClipboardCheck),
  student: navigationIcon(UsersRound),
  packages: navigationIcon(Layers),
  lesson: navigationIcon(BookOpen),
  homework: navigationIcon(PencilLine),
  schedule: navigationIcon(CalendarDays),
  attendance: navigationIcon(SquareCheck),
  grade: navigationIcon(ChartNoAxesCombined),
  payment: navigationIcon(CreditCard),
  material: navigationIcon(Folder),
  report: navigationIcon(FileText),
  message: navigationIcon(Send),
  activity: navigationIcon(History),
  privacy: navigationIcon(Archive),
} as const;

export type NavIconName = keyof typeof NavIcon;
