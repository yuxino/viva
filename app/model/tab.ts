export default class Tab {
  private _saved = null;
  // private _fileInfo = {};

  get saved() {
    return this._saved;
  }

  set saved(flag: boolean) {
    this._saved = flag;
  }

  // get fileInfo() {
  //   return this._fileInfo;
  // }

  // set fileInfo(fileInfo) {
  //   this.fileInfo = fileInfo;
  // }
}
