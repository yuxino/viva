import * as React from 'react';
import styled from 'styled-components';
import { useMappedState, useDispatch } from 'redux-react-hook';
import TabsAction from '../actions/tabs';
import { Dropable, Dragable } from '../dnd/tab';
import h5DnD from '../dnd/h5DnD';
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

  const { tabs, isEmpty } = useMappedState(state => ({
    tabs: state.tabs.tabs,
    isEmpty: state.tabs.isEmpty
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

export default h5DnD(Tabs);
