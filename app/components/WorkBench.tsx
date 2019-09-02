import * as React from 'react';
import styled from 'styled-components';
import { useMappedState } from 'redux-react-hook';
import { blockVisiable, VisableProps } from '../styled/mixin';

const Container = styled.div<VisableProps>`
  width: 200px;
  border-right: 1px solid #eae9e7;
  ${props => blockVisiable(props)};
`;

function WorkBench({ children }) {
  const { visible } = useMappedState(({ Workbench: Wb }) => ({
    visible: Wb.visible
  }));

  return (
    <Container show={visible}>
      {children} {String(visible)}{' '}
    </Container>
  );
}

export default WorkBench;
