export default class fileInfo {
  private _filename = '';
  private _fileExtention = null;
  private _fileStatus = null;

  get filename() {
    return this._filename;
  }

  set filename(name) {
    this.filename = name;
  }

  get fileExtention() {
    return this._fileExtention;
  }

  set fileExtention(extention) {
    this._fileExtention = extention;
  }

  get fileStatus() {
    return this._fileStatus;
  }

  set fileStatus(status: 'NO_MODIFY' | 'NEW_FILE' | 'MODIFYED') {
    this._fileStatus = status;
  }
}
