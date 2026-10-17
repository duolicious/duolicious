import {
  View,
} from 'react-native';
import {
  useCallback,
  useEffect,
  useState,
} from 'react';
import { DefaultText } from './../default-text';
import { Title } from './../title';
import { DefaultLongTextInput } from './../default-long-text-input';
import { ButtonWithCenteredText } from './../button/centered-text';
import { listen } from '../../events/events';
import { postSkipped } from '../../hide-and-block/hide-and-block';
import { KeyboardDismissingView } from '../keyboard-dismissing-view';
import { DefaultModal } from './default-modal';
import {
  backgroundColors,
} from './background-colors';
import { useSkipped } from '../../hide-and-block/hide-and-block';
import { HeaderWithClose } from '../button/close';
import { useAppTheme } from '../../app-theme/app-theme';

type ReportModalInitialData = {
  name: string
  personUuid: string
  context: string
};

const ErrorMessage = ({
  isTooFewChars,
  isSomethingWrong,
}: {
  isTooFewChars: boolean,
  isSomethingWrong: boolean,
}) => {
  if (isTooFewChars) {
    return (
      <DefaultText style={{color: "#e91010"}}>
        Must be at least 5 characters
      </DefaultText>
    );
  } else if (isSomethingWrong) {
    return (
      <DefaultText style={{color: "#e91010"}}>
        Something went wrong
      </DefaultText>
    );
  } else {
    return <View/>;
  }
};

const ReportModal = () => {
  const { appThemeName, appTheme } = useAppTheme();
  const [name, setName] = useState("");
  const [personUuid, setPersonUuid] = useState('');
  const [context, setContext] = useState("");
  const [reportText, setReportText] = useState("");
  const [isVisible, setIsVisible] = useState(false);
  const [isTooFewChars, setIsTooFewChars] = useState(false);
  const [isSomethingWrong, setIsSomethingWrong] = useState(false);
  const { isPosting } = useSkipped(personUuid);

  const maxChars = 2000;
  const numChars = reportText.length;

  const onChangeReportText = useCallback((s: string) => {
    setIsTooFewChars(false);
    setIsSomethingWrong(false);

    if (s.length <= maxChars)
      setReportText(s);
  }, [setIsTooFewChars, setReportText]);

  const close = useCallback(() => setIsVisible(false), [setIsVisible]);

  const submitReport = useCallback(async () => {
    if (numChars < 5) {
      setIsTooFewChars(true);
      return;
    }

    setIsTooFewChars(false);
    setIsSomethingWrong(false);

    const completeReportText = `${context.slice(0, 7999)}\n${reportText}`;

    if (await postSkipped(personUuid, true, completeReportText)) {
      setIsVisible(false);
    } else {
      setIsSomethingWrong(true);
    }
  }, [
    context,
    numChars,
    reportText,
    setIsTooFewChars,
    setIsVisible,
    postSkipped,
  ]);

  const openReportModal = useCallback((data: ReportModalInitialData) => {
    if (!data.name) return;
    if (!data.context) return;

    setName(data.name);
    setPersonUuid(data.personUuid);
    setContext(data.context);
    setReportText("");
    setIsVisible(true);
    setIsTooFewChars(false);
    setIsSomethingWrong(false);
  }, []);

  useEffect(() => {
    return listen('open-report-modal', openReportModal);
  }, [listen, openReportModal]);

  return (
    <DefaultModal visible={isVisible} transparent={false} onRequestClose={close}>
      <KeyboardDismissingView
        style={{
          width: '100%',
          height: '100%',
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'row',
          ...(
            appThemeName === 'dark'
              ? backgroundColors.dark
              : backgroundColors.light
          ),
        }}
      >
        <View
          style={{
            flex: 1,
            maxWidth: 600,
            margin: 10,
            backgroundColor: appTheme.primaryColor,
            borderRadius: 5,
            padding: 10,
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <HeaderWithClose onPress={close}>
            <Title style={{
              marginTop: 10,
              textAlign: 'center',
            }}>
              What would you like to report?
            </Title>
          </HeaderWithClose>
          <DefaultText
            style={{
              color: 'grey',
              fontSize: 14,
              alignSelf: 'center',
              textAlign: 'center',
            }}
          >
            Please include as much detail as possible. We won’t tell {name} you
            reported them.
          </DefaultText>
          <View>
            <DefaultLongTextInput
              value={reportText}
              onChangeText={onChangeReportText}
              numberOfLines={6}
              style={{
                height: 200,
              }}
            />
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginTop: 5,
              }}
            >
              <ErrorMessage
                isTooFewChars={isTooFewChars}
                isSomethingWrong={isSomethingWrong}
              />
              <DefaultText style={{color: 'grey', textAlign: 'right'}}>
                {numChars} of {maxChars}
              </DefaultText>
            </View>
          </View>
          <View
            style={{
              flexDirection: 'row',
            }}
          >
            <ButtonWithCenteredText
              onPress={close}
              containerStyle={{flex: 1}}
              backgroundColor={appTheme.primaryColor}
              textStyle={{
                color: '#555',
                fontWeight: '700',
              }}
            >
              Cancel
            </ButtonWithCenteredText>
            <ButtonWithCenteredText
              onPress={submitReport}
              containerStyle={{flex: 1}}
              backgroundColor="#e91010"
              textStyle={{
                color: '#fff',
                fontWeight: '700',
              }}
              loading={isPosting}
            >
              Submit
            </ButtonWithCenteredText>
          </View>
        </View>
      </KeyboardDismissingView>
    </DefaultModal>
  );
}

export {
  ReportModal,
  ReportModalInitialData,
};
