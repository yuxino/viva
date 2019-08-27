import * as React from 'react';
import styled from 'styled-components';
import { FileBlank } from 'styled-icons/boxicons-regular/FileBlank';
import { GitBranch } from 'styled-icons/boxicons-regular/GitBranch';
import { Search } from 'styled-icons/boxicons-regular/Search';
import { FilePdf } from 'styled-icons/icomoon/FilePdf';
import { Settings } from 'styled-icons/feather/Settings';
import { Fullscreen } from 'styled-icons/boxicons-regular/Fullscreen';

interface MenusType {
  title: string;
  icon: React.ElementType;
}

const Container = styled.div`
  border-right: 1px solid #eae9e7;
  padding: 20px 8px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
`;

const IconGroup = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
`;

const IconGroupItem = styled.li`
  padding: 10px 15px;
  & + & {
    margin-top: 15px;
  }
  svg {
    cursor: pointer;
  }
  &:hover {
    svg {
      color: black;
    }
  }
`;

const TopMenus: MenusType[] = [
  {
    title: 'Explorer',
    icon: FileBlank
  },
  {
    title: 'Source Control',
    icon: GitBranch
  },
  {
    title: 'Search',
    icon: Search
  },
  {
    title: 'Full Screen',
    icon: Fullscreen
  },
  {
    title: 'Export To PDF',
    icon: FilePdf
  }
];

const ButtonMenus: MenusType[] = [
  {
    title: 'User Settings',
    icon: Settings
  }
];

const GenMenus = ({ menus }: { menus: MenusType[] }) => (
  <IconGroup>
    {menus.map(menu => (
      <IconGroupItem key={menu.title} title={menu.title}>
        <menu.icon size={20} color="#8c8c8c" />
      </IconGroupItem>
    ))}
  </IconGroup>
);

const Sidebar = () => {
  return (
    <Container>
      {/* Top Menu */}
      <GenMenus menus={TopMenus} />
      {/* Bottom Menu */}
      <GenMenus menus={ButtonMenus} />
    </Container>
  );
};

export default Sidebar;
