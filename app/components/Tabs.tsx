import * as React from 'react';
import styled from 'styled-components';
import HTML5Backend from 'react-dnd-html5-backend';
import { DragDropContext, DragSource, DropTarget } from 'react-dnd';
import { useMappedState, useDispatch } from 'redux-react-hook';
import TabsAction from '../actions/tabs';

const Container = styled.div`
  border-bottom: 1px solid #eae9e7;
  display: flex;
  overflow-x: auto;
`;

const Types = {
  TAB: 'tab'
};

const dragSpec = {
  beginDrag(props) {
    return {
      item: props.item
    };
  }
};

function dragCollect(connect, monitor) {
  return {
    connectDragSource: connect.dragSource(),
    isDragging: monitor.isDragging()
  };
}

const dropSpec = {
  canDrop() {
    return true;
  },
  drop(dropProps, monitor, component) {
    const dragProps = monitor.getItem();
    const update = component.props.update;

    update({ dropProps, dragProps });
  }
};

function dropCollect(connect, monitor) {
  return {
    connectDropTarget: connect.dropTarget(),
    isOver: monitor.isOver()
  };
}

const Dragable = DragSource(Types.TAB, dragSpec, dragCollect);
const Dropable = DropTarget(Types.TAB, dropSpec, dropCollect);

const TabStyled = styled.div`
  padding: 10px 15px;
  border-right: 1px solid #eae9e7;
  user-select: none;
  flex-shrink: 0;
`;

const _Tab = function(props) {
  const { item } = props;

  const { isDragging, connectDragSource } = props;
  const { isOver, connectDropTarget } = props;

  return (
    <TabStyled
      ref={instance => {
        connectDragSource(instance);
        connectDropTarget(instance);
      }}
      style={{
        backgroundColor: (isDragging && 'orange') || (isOver && 'pink')
      }}
    >
      {item.data.name}
    </TabStyled>
  );
};

const Tab = Dropable(Dragable(_Tab));

const Tabs = function() {
  const dispath = useDispatch();
  const updateTabsOrder = payload =>
    dispath({ type: TabsAction.UPDATE_TAB_ORDER, payload });

  const { tabs } = useMappedState(state => ({
    tabs: state.tabs.tabs
  }));

  return (
    <Container>
      {tabs.map((tab, idx) => (
        <Tab item={tab} key={idx} update={updateTabsOrder}>
          {tab.data.name}
        </Tab>
      ))}
    </Container>
  );
};

export default DragDropContext(HTML5Backend)(Tabs);
