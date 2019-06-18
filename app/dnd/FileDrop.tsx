import * as React from 'react';
import { ConnectDropTarget, DropTargetMonitor } from 'react-dnd';
import { DropTarget, DropTargetConnector } from 'react-dnd';
import { NativeTypes } from 'react-dnd-html5-backend';
import { readFile } from 'fs-extra';
import styled from 'styled-components';

export interface DragTargetProps {
  isOver: boolean;
  canDrop: boolean;
  connectDropTarget: ConnectDropTarget;
  children: React.ReactElement;
}

const Container = styled.div`
  height: 100%;
`;

const DragTarget: React.FC<DragTargetProps> = ({
  connectDropTarget,
  children
}) => {
  return (
    <Container
      ref={instance => {
        connectDropTarget(instance);
      }}
    >
      {children}
    </Container>
  );
};

export default DropTarget(
  NativeTypes.FILE,
  {
    drop(props: DragTargetProps, monitor: DropTargetMonitor) {
      (async () => {
        const files = monitor.getItem().files;

        // single file ...
        const file = files[0];
        const path = file.path;

        const buffer = await readFile(path);
        const content = buffer.toString();

        console.log(content);

        // editor.innerText = content;
        // setContent(content);
      })();
    }
  },
  (connect: DropTargetConnector, monitor: DropTargetMonitor) => ({
    connectDropTarget: connect.dropTarget(),
    isOver: monitor.isOver(),
    canDrop: monitor.canDrop()
  })
)(DragTarget);
