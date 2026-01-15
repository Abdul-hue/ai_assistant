import { useEffect } from 'react';
import Joyride, { CallBackProps, STATUS, Step } from 'react-joyride';

interface OnboardingTourProps {
  run: boolean;
  onComplete: () => void;
}

const steps: Step[] = [
  {
    target: '[data-tour="dashboard"]',
    content: 'Welcome to PA Agent! This is your dashboard where you can view all your AI agents and their status.',
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '[data-tour="create-agent"]',
    content: 'Click here to create a new AI agent for WhatsApp automation.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="agent-chat"]',
    content: 'Access the chat interface to communicate with your agents.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="navigation"]',
    content: 'Use the sidebar to navigate between different sections of the app.',
    placement: 'right',
  },
];

export function OnboardingTour({ run, onComplete }: OnboardingTourProps) {
  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status } = data;
    
    if ([STATUS.FINISHED, STATUS.SKIPPED].includes(status)) {
      onComplete();
    }
  };

  return (
    <Joyride
      steps={steps}
      run={run}
      continuous
      showProgress
      showSkipButton
      callback={handleJoyrideCallback}
      styles={{
        options: {
          primaryColor: '#8b5cf6', // violet-500
          zIndex: 10000,
        },
        overlay: {
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
        },
        tooltip: {
          borderRadius: '8px',
        },
        buttonNext: {
          backgroundColor: '#8b5cf6',
          borderRadius: '6px',
        },
        buttonBack: {
          color: '#8b5cf6',
        },
      }}
      locale={{
        back: 'Back',
        close: 'Close',
        last: 'Finish',
        next: 'Next',
        skip: 'Skip tour',
      }}
    />
  );
}
