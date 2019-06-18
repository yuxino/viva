import { DragSource, DropTarget } from 'react-dnd';

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

export { Dragable, Dropable };
