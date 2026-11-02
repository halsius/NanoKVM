import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { Button, Divider, Input, Modal, Progress, Select, Tooltip } from 'antd';
import type { InputRef } from 'antd';
import clsx from 'clsx';
import { useSetAtom } from 'jotai';
import { ClipboardIcon, ClipboardPasteIcon, FileUpIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { paste } from '@/api/hid';
import { keyboardLockAtom } from '@/jotai/keyboard.ts';

type InputStatus = '' | 'error';

type SendProgress = {
  sent: number;
  total: number;
};

// Characters typed as a dead-key sequence (two keystrokes) on the Swedish layout
const SWEDISH_SEQUENCE_CHARS = new Set(['`', '´', '^', '~', '¨', 'é', 'É']);
const SWEDISH_EXTRA_CHARS = 'åäöÅÄÖéÉ´¨§½¤€£µ';

// The server types one keystroke per 30ms and rejects requests above 25s of
// typing, so each chunk stays well below that budget.
const STROKE_DELAY_MS = 30;
const MAX_STROKES_PER_CHUNK = 600;

const MAX_FILE_SIZE = 256 * 1024;

function strokeCost(ch: string, langue: string): number {
  return langue === 'se' && SWEDISH_SEQUENCE_CHARS.has(ch) ? 2 : 1;
}

function countStrokes(text: string, langue: string): number {
  let strokes = 0;
  for (const ch of text) {
    strokes += strokeCost(ch, langue);
  }
  return strokes;
}

function chunkText(text: string, langue: string): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let strokes = 0;

  for (const ch of text) {
    const cost = strokeCost(ch, langue);
    if (strokes + cost > MAX_STROKES_PER_CHUNK && current.length > 0) {
      chunks.push(current.join(''));
      current = [];
      strokes = 0;
    }
    current.push(ch);
    strokes += cost;
  }
  if (current.length > 0) {
    chunks.push(current.join(''));
  }
  return chunks;
}

function formatDuration(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

type PasteProps = {
  variant?: 'menu' | 'toolbar';
};

export const Paste = ({ variant = 'menu' }: PasteProps) => {
  const { t } = useTranslation();
  const setKeyboardLock = useSetAtom(keyboardLockAtom);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isClipboardSupported, setIsClipboardSupported] = useState(false);
  const [isReadingClipboard, setIsReadingClipboard] = useState(false);
  const [langue, setLangue] = useState('se');
  const [status, setStatus] = useState<InputStatus>('');
  const [errMsg, setErrMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<SendProgress | null>(null);

  const inputRef = useRef<InputRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  const languages = [
    { value: 'en', label: t('keyboard.dropdownEnglish') },
    { value: 'de', label: t('keyboard.dropdownGerman') },
    { value: 'fr', label: t('keyboard.dropdownFrench') },
    { value: 'ru', label: t('keyboard.dropdownRussian') },
    { value: 'se', label: t('keyboard.dropdownSwedish') }
  ];

  useEffect(() => {
    setIsClipboardSupported('clipboard' in navigator);
  }, []);

  function onChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setStatus(isValidForLanguage(value, langue) ? '' : 'error');
    setInputValue(value);
  }

  function onLangueChange(value: string) {
    setLangue(value);
    setStatus(isValidForLanguage(inputValue, value) ? '' : 'error');
  }

  async function readFromClipboard() {
    if (isReadingClipboard) return;
    setIsReadingClipboard(true);

    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        return;
      }
      setInputValue((value) => value + text);
    } catch (error) {
      if (error instanceof Error && error.name === 'NotAllowedError') {
        setErrMsg(t('keyboard.clipboardPermissionDenied'));
        return;
      }
      setErrMsg(t('keyboard.clipboardReadError'));
    } finally {
      setIsReadingClipboard(false);
    }
  }

  async function onFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      setErrMsg(t('keyboard.fileTooLarge'));
      return;
    }

    try {
      const text = await file.text();
      const normalized = text.replace(/\r\n?/g, '\n');
      setStatus(isValidForLanguage(normalized, langue) ? '' : 'error');
      setInputValue(normalized);
      setErrMsg('');
    } catch {
      setErrMsg(t('keyboard.fileReadError'));
    }
  }

  // Extended RU → EN translation including punctuation
  function translateRuToEnWithPunctuation(value: string): string {
    const letterMap: Record<string, string> = {
      ё: '`',
      й: 'q',
      ц: 'w',
      у: 'e',
      к: 'r',
      е: 't',
      н: 'y',
      г: 'u',
      ш: 'i',
      щ: 'o',
      з: 'p',
      х: '[',
      ъ: ']',
      ф: 'a',
      ы: 's',
      в: 'd',
      а: 'f',
      п: 'g',
      р: 'h',
      о: 'j',
      л: 'k',
      д: 'l',
      ж: ';',
      э: "'",
      я: 'z',
      ч: 'x',
      с: 'c',
      м: 'v',
      и: 'b',
      т: 'n',
      ь: 'm',
      б: ',',
      ю: '.'
    };

    const punctuationMap: Record<string, string> = {
      '"': '@',
      '№': '#',
      ';': '$',
      ':': '^',
      '?': '&',
      Ё: '~',
      '/': '|',
      '.': '/',
      ',': '?'
    };

    return Array.from(value)
      .map((ch) => {
        const lower = ch.toLowerCase();
        if (letterMap[lower]) {
          const translated = letterMap[lower];
          return ch === lower ? translated : translated.toUpperCase();
        }
        if (punctuationMap[ch]) {
          return punctuationMap[ch];
        }
        return ch;
      })
      .join('');
  }

  async function submit() {
    if (isLoading || !inputValue) return;
    setIsLoading(true);
    setErrMsg('');
    cancelRef.current = false;

    const normalized = inputValue.replace(/\r\n?/g, '\n');
    const textToSend = langue === 'ru' ? translateRuToEnWithPunctuation(normalized) : normalized;
    const chunks = chunkText(textToSend, langue);
    setProgress({ sent: 0, total: chunks.length });

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (cancelRef.current) {
          // keep the untyped remainder so the user can resume
          setInputValue(chunks.slice(i).join(''));
          return;
        }

        const rsp = await paste(chunks[i], langue);
        if (rsp.code !== 0) {
          setErrMsg(rsp.msg);
          setInputValue(chunks.slice(i).join(''));
          return;
        }
        setProgress({ sent: i + 1, total: chunks.length });
      }

      setInputValue('');
      setStatus('');
      setErrMsg('');
      setIsModalOpen(false);
    } catch {
      setErrMsg(t('keyboard.pasteFailed'));
    } finally {
      setIsLoading(false);
      setProgress(null);
    }
  }

  function cancelSend() {
    cancelRef.current = true;
  }

  function afterOpenChange(open: boolean) {
    if (open) {
      inputRef.current?.focus();
    }

    setKeyboardLock({ source: 'paste-modal', locked: open });
  }

  function isValidForLanguage(value: string, selectedLangue: string) {
    const isRussian = selectedLangue === 'ru';
    const isFrench = selectedLangue === 'fr';
    const isSwedish = selectedLangue === 'se';

    for (const ch of value) {
      const code = ch.codePointAt(0) ?? 0;

      if (isRussian) {
        // For Russian language, allow Cyrillic letters and special characters
        // that can be typed on Russian keyboard (but not English letters)
        if (
          (code >= 0x0410 && code <= 0x042f) || // (А-Я)
          (code >= 0x0430 && code <= 0x044f) || // (а-я)
          code === 0x0401 || // (Ё)
          code === 0x0451 || // (ё)
          (code >= 0x20 &&
            code <= 0x7e &&
            !(code >= 0x41 && code <= 0x5a) &&
            !(code >= 0x61 && code <= 0x7a)) // Special chars, digits, space, but not English letters
        ) {
          continue;
        }
        return false;
      } else if (isFrench) {
        // For French, allow ASCII and Latin-1/Extended accented characters
        // (é è ê ë à â ù û ç î ï ô œ æ ° µ £ § ¨ etc.)
        if (code <= 0x7f) continue;
        if (code >= 0x00a0 && code <= 0x017e) continue;
        return false;
      } else if (isSwedish) {
        // For Swedish, allow ASCII plus the characters on the Swedish layout
        if (code <= 0x7f) continue;
        if (SWEDISH_EXTRA_CHARS.includes(ch)) continue;
        return false;
      } else {
        // For English/German, only allow ASCII
        if (code <= 0x7f) continue;
        return false;
      }
    }
    return true;
  }

  const totalStrokes = countStrokes(inputValue, langue);
  const estimatedMs = totalStrokes * STROKE_DELAY_MS;

  return (
    <>
      {variant === 'toolbar' ? (
        <Tooltip title={t('keyboard.paste')} placement="bottom" mouseEnterDelay={0.6}>
          <div
            className="flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded text-neutral-300 hover:bg-neutral-700/80 hover:text-white"
            onClick={() => setIsModalOpen(true)}
          >
            <ClipboardIcon size={18} />
          </div>
        </Tooltip>
      ) : (
        <div
          className={clsx(
            'flex cursor-pointer select-none items-center space-x-2 rounded py-1 pl-2 pr-5 hover:bg-neutral-700/70'
          )}
          onClick={() => setIsModalOpen(true)}
        >
          <ClipboardIcon size={18} />
          <span>{t('keyboard.paste')}</span>
        </div>
      )}

      <Modal
        open={isModalOpen}
        centered={false}
        footer={null}
        onCancel={() => setIsModalOpen(false)}
        afterOpenChange={afterOpenChange}
      >
        <div className="flex flex-col">
          <span className="text-xl">{t('keyboard.paste')}</span>
          <span className="text-sm text-neutral-600">{t('keyboard.tips')}</span>
        </div>

        <Divider style={{ margin: '14px 0' }} />

        <div
          className={clsx(
            'flex w-full items-center space-x-3 pb-2',
            isClipboardSupported ? 'justify-start' : 'justify-end'
          )}
        >
          {isClipboardSupported && (
            <Button
              color="default"
              variant="filled"
              icon={<ClipboardPasteIcon size={16} />}
              loading={isReadingClipboard}
              disabled={isLoading}
              onClick={readFromClipboard}
              className="flex items-center"
            >
              {t('keyboard.readClipboard') || 'Read from Clipboard'}
            </Button>
          )}

          <Button
            color="default"
            variant="filled"
            icon={<FileUpIcon size={16} />}
            disabled={isLoading}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center"
          >
            {t('keyboard.loadFile')}
          </Button>
          <input ref={fileInputRef} type="file" className="hidden" onChange={onFileSelected} />

          <Select
            value={langue}
            variant="filled"
            disabled={isLoading}
            onChange={onLangueChange}
            options={languages}
          ></Select>
        </div>

        <Input.TextArea
          ref={inputRef}
          value={inputValue}
          status={status}
          showCount
          disabled={isLoading}
          autoSize={{ minRows: 6, maxRows: 12 }}
          placeholder={t('keyboard.placeholder')}
          onFocus={() => setErrMsg('')}
          onChange={onChange}
        />

        {totalStrokes > MAX_STROKES_PER_CHUNK && !isLoading && (
          <div className="pt-1 text-sm text-neutral-500">
            {t('keyboard.estimatedTime')}: ~{formatDuration(estimatedMs)}
          </div>
        )}

        {errMsg && <div className="pt-1 text-sm text-red-500">{errMsg}</div>}

        {progress && progress.total > 1 && (
          <div className="flex items-center space-x-3 pt-2">
            <Progress
              className="flex-1"
              percent={Math.round((progress.sent / progress.total) * 100)}
              status="active"
            />
            <Button size="small" onClick={cancelSend}>
              {t('keyboard.cancel')}
            </Button>
          </div>
        )}

        <div className="flex justify-center py-5">
          <Button
            type="primary"
            loading={isLoading}
            htmlType="submit"
            style={{ width: '300px' }}
            onClick={submit}
          >
            {t('keyboard.submit')}
          </Button>
        </div>
      </Modal>
    </>
  );
};
