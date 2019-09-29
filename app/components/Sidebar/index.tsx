import * as React from 'react';
import { useState } from 'react';
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
  const [currentMenuSymbol, setCurrentMenuSymbol] = useState<Symbol>(null);
  const dispatch = useDispatch();

  const beforeClick = ({ cb, symbol, title }) => {
    return () => {
      if (showWorkBench) {
        if (currentMenuSymbol === symbol) {
          dispatch({
            type: WorkBenchActions.TOGGLE_WORKBENCH,
            payload: {
              title
            }
          });
        } else {
          dispatch({
            type: WorkBenchActions.OPEN_WORKBENCH,
            payload: {
              title
            }
          });
        }
        setCurrentMenuSymbol(symbol);
        typeof cb === 'function' && cb();
      }
    };
  };

  return (
    <IconGroup>
      {menus.map(menu => {
        const { onClick, symbol, title } = menu;
        return (
          <IconGroupItem
            onClick={beforeClick({
              cb: onClick,
              symbol: symbol,
              title: title
            })}
            key={symbol.toString()}
            title={title}
          >
            <menu.icon
              size={20}
              color={symbol == currentMenuSymbol ? '#000000' : '#8c8c8c'}
            />
          </IconGroupItem>
        );
      })}
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
