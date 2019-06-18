import * as React from 'react';
import styled from 'styled-components';

const TabStyled = styled.div`
  padding: 10px 15px;
  border-right: 1px solid #eae9e7;
  user-select: none;
  flex-shrink: 0;
  background: #ffffff;
`;

const Tab = function(props) {
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

export default Tab;
