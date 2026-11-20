import type { Language } from './core.js';
const ja = {
  calendar: 'カレンダー', calendarTitle: '発見のある日々。', calendarYear: '年', calendarMonth: '月', chooseMonth: '年月を選ぶ', jumpMonth: '移動', previousMonth: '前の月', nextMonth: '次の月', noDay: 'この日の発見はありません。',
  category: '種類', first: '初めて', insight: '気づき', emotion: '感動', achievement: '達成', other: 'その他',
  choosePhoto: '写真を選ぶ', takePhoto: 'カメラで撮る', cameraHelp: 'カメラ対応端末では撮影画面を開きます。端末・ブラウザによってはファイル選択が表示されます。',
  photo: '写真（任意・1枚）', removePhoto: '写真を外す', photoHelp: '20MBまで。端末内で長辺1600pxのJPEGに縮小して保存します。', photoError: '写真を読み込めません。20MB以下の対応画像（JPEG・PNGなど）を選んでください。',
  random: 'ランダムに出会う',

  tagline: '日々の小さな発見を、未来の自分へ。', new: '発見を記録', weekly: '1週間後の判定', yearly: '1年後の振り返り', deck: '発見のカードデッキ', settings: '設定',
  menu: 'メニューを開く', close: '閉じる', add: '＋ 発見', waiting: '待ち',
  eyebrow: 'A LITTLE DISCOVERY', title: '今日、どんな発見が\nありましたか？', intro: '初めてのこと。気づいたこと。人生の小さな発見を記録しましょう。',
  content: '発見したこと', placeholder: 'たとえば、いつもの道に小さな花屋さんを見つけた。', date: '発見した日時', record: '＋ 発見を記録',
  saved: '発見を記録しました', local: 'この端末に、大切に保存します。',
  weeklyTitle: 'この発見、今も大切？', weeklyIntro: '少し時間がたった今の気持ちで選んでみよう。',
  keep: '残す', archive: 'アーカイブ', skip: 'あとで', archiveNote: 'アーカイブは削除ではありません。あとから復元できます。', weeklyHint: '← アーカイブ · ↑ あとで · 残す →', judged: '判定を保存しました',
  yearlyTitle: 'あれから1年。\nこの発見は今どうなった？', yearlyIntro: '変わったことも、変わらないことも。', score: '今の大切さ', low: '今はそれほど', middle: '今も大切', high: '以前より大切', lowFull: '今はそれほど大切ではない',
  comment: '変化や近況をひとこと（任意）', commentPlaceholder: '今の気持ちを残してみよう。', reviewSave: '振り返りを保存', reviewed: '振り返りを保存しました', yearlyHint: '← あとで · 保存 →',
  deckTitle: 'あなたの発見に、\nもう一度出会う。', deckIntro: 'ひとつひとつが、あなたの人生のかけら。', newest: '新しい順', oldest: '古い順', sort: '表示順', includeArchived: 'アーカイブを含める', from: '開始日', to: '終了日', period: '期間で絞り込む', clear: '条件をリセット', invalidRange: '終了日は開始日以降にしてください。',
  prev: '前のカード', next: '次のカード', flip: 'タップして判定・振り返りを見る', flipBack: 'タップして発見に戻る', editHint: '長押しで編集', edit: '編集', status: '判定', pending: '未判定', kept: '残した発見', archived: 'アーカイブ済み', notReviewed: '1年後の振り返りはまだありません。', reviewLabel: '1年後の気持ち',
  emptyWeekly: '判定待ちの発見はありません', emptyWeeklyBody: '発見から7日たつと、ここに届きます。', emptyYearly: '評価待ちの発見はありません', emptyYearlyBody: '「残す」を選んだ発見が、1年後に届きます。', emptyDeck: 'まだ、ここは白紙です', emptyDeckBody: '小さな発見をひとつ、残してみませんか。', emptyFilter: 'この条件の発見はありません', emptyFilterBody: 'カテゴリや期間などの表示条件を変えてみてください。',
  settingsTitle: 'アプリの設定', language: '言語 / Language', privacyTitle: 'データはこの端末の中に', privacy: '発見・判定・振り返り・設定は、このブラウザのIndexedDBに保存されます。ユーザーデータをサーバーへ送信することはありません。ログインやクラウド同期はありません。',
  backupTitle: '思い出のバックアップ', backup: '端末の設定・容量不足・ブラウザのデータ削除で記録が失われることがあります。定期的にJSONファイルを保存してください。', export: 'JSONを書き出す', import: 'JSONから復元', importNote: '復元すると、この端末の全記録と設定が置き換わります。', importConfirm: 'この端末の全記録と設定を、選択したバックアップで置き換えます。元に戻せません。復元しますか？', importDone: 'バックアップを復元しました', exportDone: 'バックアップファイルを作成しました', invalidBackup: 'バックアップの形式が正しくないか、未対応のバージョンです。データは変更していません。',
  installTitle: 'ホーム画面で使う', install: 'iPhoneのSafariで開き、共有メニューから「ホーム画面に追加」を選んでください。', installData: 'Safariのタブとホーム画面のPWAでは、データが共有されない場合があります。移行にはJSONバックアップを利用してください。', offline: '初回のオンライン読み込み後、オフライン準備完了の表示が出ると、通信なしで主要機能を使えます。', offlineReady: 'オフラインで利用できます', offlinePreparing: 'オフラインの準備中', offlineUnavailable: 'オフライン準備が完了していません。オンラインで再読み込みしてください。', update: '更新があります', updateAction: '更新する', updateNote: '入力中の内容を保存してから更新してください。',
  editTitle: '発見を編集', editReview: '年次評価を編集', save: '変更を保存', cancel: 'キャンセル', delete: 'この発見を削除', deleteConfirm: 'この発見と判定・振り返りを完全に削除します。元に戻せません。削除しますか？', deleted: '発見を削除しました', updated: '発見を更新しました', restore: 'アーカイブから復元', restored: '発見を「残す」に復元しました',
  error: '保存できませんでした。端末の空き容量やブラウザの設定を確認して、もう一度お試しください。', loadError: '端末内のデータを読み込めませんでした。ブラウザのストレージ設定や、ほかに開いているタブを確認してください。', retry: '再読み込み', required: '発見の内容と有効な日時を入力してください。', busy: '保存中…', total: '件の発見', countUnit: '件', allDone: 'ひと息ついて、またいつでも。'
};
export type MessageKey = keyof typeof ja;
const en: Record<MessageKey, string> = {
  calendar: 'Calendar', calendarTitle: 'Days of discovery.', calendarYear: 'Year', calendarMonth: 'Month', chooseMonth: 'Choose a year and month', jumpMonth: 'Go', previousMonth: 'Previous month', nextMonth: 'Next month', noDay: 'No discoveries on this day.',
  category: 'Category', first: 'First experience', insight: 'Insight', emotion: 'Moved', achievement: 'Achievement', other: 'Other',
  choosePhoto: 'Choose photo', takePhoto: 'Take a photo', cameraHelp: 'Opens the camera on supported devices. Some devices or browsers show a file picker instead.',
  photo: 'Photo (optional, one)', removePhoto: 'Remove photo', photoHelp: 'Up to 20 MB. Resized on-device to a JPEG with a maximum side of 1600 px.', photoError: 'Could not read this photo. Choose a supported image (such as JPEG or PNG) under 20 MB.',
  random: 'Discover at random',

  tagline: 'Little discoveries, for your future self.', new: 'New discovery', weekly: 'One-week check-in', yearly: 'One-year reflection', deck: 'Discovery deck', settings: 'Settings',
  menu: 'Open menu', close: 'Close', add: '+ Discovery', waiting: 'waiting',
  eyebrow: 'A LITTLE DISCOVERY', title: 'What did you\ndiscover today?', intro: 'Record life’s firsts, insights, and little discoveries.',
  content: 'Your discovery', placeholder: 'I found a tiny flower shop on my usual walk.', date: 'Date and time of discovery', record: '+ Save discovery', saved: 'Discovery saved', local: 'Kept safely on this device.',
  weeklyTitle: 'Does it still matter to you?', weeklyIntro: 'A little time has passed. How do you feel now?', keep: 'Keep', archive: 'Archive', skip: 'Later', archiveNote: 'Archiving is not deleting. You can restore it anytime.', weeklyHint: '← Archive · ↑ Later · Keep →', judged: 'Decision saved',
  yearlyTitle: 'One year later.\nWhat does it mean to you now?', yearlyIntro: 'What has changed, and what has stayed with you?', score: 'How much it matters now', low: 'Less now', middle: 'Still matters', high: 'More than before', lowFull: 'It does not matter as much now', comment: 'A change or an update (optional)', commentPlaceholder: 'Leave a few words about how you feel now.', reviewSave: 'Save reflection', reviewed: 'Reflection saved', yearlyHint: '← Later · Save →',
  deckTitle: 'Meet your\ndiscoveries again.', deckIntro: 'Little pieces of the life you are living.', newest: 'Newest first', oldest: 'Oldest first', sort: 'Sort order', includeArchived: 'Include archived', from: 'From', to: 'To', period: 'Filter by date', clear: 'Reset filters', invalidRange: 'The end date must be on or after the start date.',
  prev: 'Previous card', next: 'Next card', flip: 'Tap to see your decision and reflection', flipBack: 'Tap to return to your discovery', editHint: 'Hold to edit', edit: 'Edit', status: 'Decision', pending: 'Not decided', kept: 'Kept', archived: 'Archived', notReviewed: 'No one-year reflection yet.', reviewLabel: 'One year later',
  emptyWeekly: 'No discoveries waiting', emptyWeeklyBody: 'Discoveries arrive here seven days after they happen.', emptyYearly: 'No reflections waiting', emptyYearlyBody: 'Discoveries you choose to keep return after one year.', emptyDeck: 'A fresh page, for now', emptyDeckBody: 'Start with one little discovery.', emptyFilter: 'No matching discoveries', emptyFilterBody: 'Try different categories, dates, or archive settings.',
  settingsTitle: 'App settings', language: 'Language / 言語', privacyTitle: 'Your data stays on this device', privacy: 'Discoveries, decisions, reflections, and settings are stored in this browser’s IndexedDB. Your personal data is never sent to a server. There is no login or cloud sync.', backupTitle: 'A backup for your memories', backup: 'Device settings, low storage, or clearing browser data can erase your records. Save a JSON backup regularly.', export: 'Export JSON', import: 'Restore from JSON', importNote: 'Restoring replaces all records and settings on this device.', importConfirm: 'Replace ALL records and settings on this device with the selected backup? This cannot be undone.', importDone: 'Backup restored', exportDone: 'Backup file created', invalidBackup: 'This backup is invalid or uses an unsupported version. Your data has not been changed.',
  installTitle: 'Make it a home screen app', install: 'Open in Safari on your iPhone, then choose “Add to Home Screen” from the Share menu. Use the installed PWA as your main place to record.', installData: 'Safari tabs and the home screen PWA may not share data. Use a JSON backup to move your records.', offline: 'After the first online visit, the offline-ready indicator confirms that core features are available without a connection.', offlineReady: 'Ready to use offline', offlinePreparing: 'Preparing offline access', offlineUnavailable: 'Offline setup is incomplete. Reload while online.', update: 'An update is available', updateAction: 'Update', updateNote: 'Save any unfinished input before updating.',
  editTitle: 'Edit discovery', editReview: 'Edit one-year reflection', save: 'Save changes', cancel: 'Cancel', delete: 'Delete this discovery', deleteConfirm: 'Permanently delete this discovery, its decision, and reflection? This cannot be undone.', deleted: 'Discovery deleted', updated: 'Discovery updated', restore: 'Restore from archive', restored: 'Discovery restored as kept', error: 'Could not save. Check available storage and browser settings, then try again.', loadError: 'Could not read device storage. Check browser storage settings and other open tabs.', retry: 'Reload', required: 'Enter a discovery and a valid date and time.', busy: 'Saving…', total: 'discoveries', countUnit: 'items', allDone: 'Take a breath. Come back whenever you like.'
};
export function translator(language: Language): (key: MessageKey) => string {
  return key => (language === 'ja' ? ja : en)[key];
}
export function browserLanguage(): Language {
  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}
