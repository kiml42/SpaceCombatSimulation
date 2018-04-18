using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.ObjectManagement
{
    class TimeDialationDevice
    {
        public float LargeIncrement = 0.5f;
        public float SmallIncrement = 0.1f;
        public float TimeScaleCap = 15;
        public float TimeScaleFloor = 0.1f;

        private List<float> _deltas = new List<float>();

        public float AutoTimeScaleTime = 5;
        public float IdealDeltaTime = 0.04f;
        public float ChangeThreshold = 0.01f;
        public float AutoChangeMultiplier = 10;

        public void AutoSetTimeScale()
        {
            _deltas.Add(Time.unscaledDeltaTime);
            if(_deltas.Sum() > AutoTimeScaleTime)
            {
                var averageDelta = _deltas.Average();
                AutoSetTimeScaleFromAverageDeltaTime(averageDelta);
                _deltas = new List<float>();
            }
        }

        private void AutoSetTimeScaleFromAverageDeltaTime(float averageDelta)
        {
            var desiredChange = IdealDeltaTime - averageDelta;
            if(Math.Abs(desiredChange) > ChangeThreshold)
            {
                Time.timeScale = GetTimescaleInRange(Time.timeScale +(desiredChange * AutoChangeMultiplier));
                //Debug.Log("TimeScale auto set to " + Time.timeScale);
                return;
            }
            //Debug.Log("Frame rate is within tollerance. desiredChange =  " + desiredChange);
        }

        public void AccelerateTime()
        {
            var currentTimeScale = Time.timeScale;
            if (currentTimeScale < 1)
            {
                currentTimeScale += SmallIncrement;
            }
            else
            {
                currentTimeScale += LargeIncrement;
            }
            Time.timeScale = GetTimescaleInRange(currentTimeScale);
            Debug.Log("TimeScale accelerated to " + Time.timeScale);
        }

        private float GetTimescaleInRange(float desiredTimeScale)
        {
            desiredTimeScale = Math.Max(TimeScaleFloor, desiredTimeScale);
            desiredTimeScale = Math.Min(TimeScaleCap, desiredTimeScale);
            return desiredTimeScale;
        }

        public void DecelerateTime()
        {
            var currentTimeScale = Time.timeScale;
            if (currentTimeScale <= 1)
            {
                currentTimeScale = Math.Max(0, currentTimeScale - SmallIncrement);
                return;
            } else
            {
                currentTimeScale -= LargeIncrement;
            }
            Time.timeScale = GetTimescaleInRange(currentTimeScale);
            Debug.Log("TimeScale decelerated to " + Time.timeScale);
        }
    }
}
