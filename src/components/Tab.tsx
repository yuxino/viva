import * as React from "react";
import styled from "styled-components";
import { useDispatch } from "redux-react-hook";
import { Close } from "@styled-icons/evil/Close";
import { vhc } from "../styled/extend";
import ViewActions from "../actions/View";

const TabStyled = styled.div`
  ${vhc};
  padding: 10px 15px;
  border-right: 1px solid #eae9e7;
  user-select: none;
  flex-shrink: 0;
  background: #ffffff;
`;

const CloseIcon = styled(Close)`
  margin-left: 5px;
`;

const Tab = function (props) {
  const { item } = props;
  const { isDragging, connectDragSource } = props;
  const { isOver, connectDropTarget } = props;
  const dispath = useDispatch();
  const closeTab = () =>
    dispath({ type: ViewActions.CLEAR_EDITOR_CONTENT, payload: { tab: item } });

  return (
    <TabStyled
      ref={(instance) => {
        connectDragSource(instance);
        connectDropTarget(instance);
      }}
      style={{
        backgroundColor: (isDragging && "orange") || (isOver && "pink"),
      }}
    >
      {item.data.name}
      <CloseIcon size="15" onClick={closeTab} />
    </TabStyled>
  );
};

export default Tab;
