import * as React from "react";
import { Layout } from "../components";
import styled from "styled-components";
import { useMappedState } from "redux-react-hook";
import { flexVisiable, VisableProps } from "../styled/mixin";

const Container = styled(Layout.Container)<VisableProps>`
  ${(props) => flexVisiable(props)};
`;

const Box = styled.div`
  flex: 1;
  text-align: right;
  margin-top: 100px;
  margin-right: 150px;
`;

const Logo = styled.h1`
  margin: 0;
  font-size: 100px;
  letter-spacing: 10px;
  font-weight: 300;
  margin-bottom: 25px;
`;

const Hint = styled.p`
  font-size: 22px;
  font-weight: 300;
`;

const hints = [
  "Drag Markdown to see preview",
  "Drag Folder to editor open project",
  "Click Icon to show workbench",
  "Drag Image to edtior will auto upload to github",
  "Login can sync github issues",
  "Enjoy :D",
];

export default function () {
  const { isEmpty } = useMappedState(({ Tabs }) => ({
    isEmpty: Tabs.isEmpty,
  }));

  return (
    <Container show={isEmpty}>
      <Box>
        <Logo>ViVa</Logo>
        {hints.map((text, idx) => (
          <Hint key={idx}>{text}</Hint>
        ))}
      </Box>
    </Container>
  );
}
