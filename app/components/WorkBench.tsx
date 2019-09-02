import * as React from 'react';
import styled from 'styled-components';
import { useMappedState } from 'redux-react-hook';

const Container = styled.div`
  width: 200px;
  border-right: 1px solid #eae9e7;
`;

function WorkBench({ children }) {
  // const { show } = useMappedState(state => ({
  //   show: state.workbench.show
  // }));

  return <Container>{children}</Container>;
}

export default WorkBench;
