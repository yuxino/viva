import * as React from 'react';
import styled from 'styled-components';
import { useMappedState, useDispatch } from 'redux-react-hook';
import TabsAction from '../actions/Tabs';
import { Dropable, Dragable } from '../dnd/Tab';
import Tab from './Tab';

const Container = styled.div`
  border-bottom: ${({ isEmpty }: { isEmpty: boolean }) =>
    !isEmpty && '1px solid #eae9e7'};
  display: flex;
  overflow-x: auto;
`;

const DnDTab = Dropable(Dragable(Tab));

const Tabs = function() {
  const dispath = useDispatch();
  const updateTabsOrder = payload =>
    dispath({ type: TabsAction.UPDATE_TAB_ORDER, payload });

  const { tabs, isEmpty } = useMappedState(({ Tabs }) => ({
    tabs: Tabs.tabs,
    isEmpty: Tabs.isEmpty
  }));

  return (
    <Container isEmpty={isEmpty}>
      {tabs.map((tab, idx) => (
        <DnDTab item={tab} key={idx} update={updateTabsOrder}>
          {tab.data.name}
        </DnDTab>
      ))}
    </Container>
  );
};

export default Tabs;
