import * as React from 'react';
import styled from 'styled-components';
import { TopMenus, ButtonMenus, MenusType } from './modules';
import { useDispatch } from 'redux-react-hook';
import WorkBenchActions from '../../actions/Workbench';

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

interface GenMenusProps {
  menus: MenusType[];
  showWorkBench?: boolean;
}

const GenMenus = ({ menus, showWorkBench }: GenMenusProps) => {
  const dispatch = useDispatch();
  let currentMenuSymbol = null;

  const beforeClick = (cb, symbol) => {
    return () => {
      if (currentMenuSymbol === symbol) {
        showWorkBench && dispatch({ type: WorkBenchActions.TOGGLE_WORKBENCH });
      } else if (currentMenuSymbol === null) {
        currentMenuSymbol = symbol;
        showWorkBench && dispatch({ type: WorkBenchActions.TOGGLE_WORKBENCH });
      } else {
        currentMenuSymbol = symbol;
      }
      typeof cb === 'function' && cb();
    };
  };

  return (
    <IconGroup>
      {menus.map(menu => (
        <IconGroupItem
          onClick={beforeClick(menu.onClick, Symbol('menu'))}
          key={menu.title}
          title={menu.title}
        >
          <menu.icon size={20} color="#8c8c8c" />
        </IconGroupItem>
      ))}
    </IconGroup>
  );
};

const Sidebar = () => {
  return (
    <Container>
      {/* Top Menu */}
      <GenMenus menus={TopMenus} showWorkBench />
      {/* Bottom Menu */}
      <GenMenus menus={ButtonMenus} />
    </Container>
  );
};

export default Sidebar;
