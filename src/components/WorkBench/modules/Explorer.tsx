import * as React from "react";
import { useState, useEffect } from "react";
import { useMappedState, useDispatch } from "redux-react-hook";
import { readFile, readdir } from "fs-extra";
import { getFileType } from "lemuro";
import ViewActions from "../../../actions/View";

function Explorer() {
  const dispatch = useDispatch();
  const { root } = useMappedState(({ Explore }) => ({ root: Explore.root }));
  if (root === "") return <div>'NOT THING'</div>;
  const updateView = async (path, name) => {
    console.log(getFileType(path));
    // console.log(await readFile(path));
    // const buffer = await readFile(path);
    // const content = buffer.toString();
    // const fileInfo = { content, name };
    // dispatch({
    //   type: ViewActions.TABS_UPDATE,
    //   payload: { fileInfo },
    // });
  };
  const [x, setX] = useState([]);
  useEffect(() => {
    readdir(root).then((v) => {
      setX(v);
    });
  }, [root]);
  return (
    <ul>
      {x?.map((name, idx) => {
        return (
          <li onClick={() => updateView(`${root}/${name}`, name)} key={idx}>
            {name}
          </li>
        );
      })}
    </ul>
  );
}

export default Explorer;
