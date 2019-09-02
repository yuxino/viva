import Explorer from './Explorer';
import SourceControl from './SourceControl';
import Search from './Search';
import Fullscreen from './Fullscreen';
import ExportPdf from './ExportPdf';
import Settings from './Settings';

export interface MenusType {
  title: string;
  icon: React.ElementType;
  onClick?: (event) => void;
}

const TopMenus: MenusType[] = [
  Explorer,
  SourceControl,
  Search,
  Fullscreen,
  ExportPdf
];

const ButtonMenus: MenusType[] = [Settings];

export { TopMenus, ButtonMenus };
