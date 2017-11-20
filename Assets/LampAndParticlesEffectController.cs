using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class LampAndParticlesEffectController : MonoBehaviour {
    public ParticleSystem Plume;
    public Light Lamp;

    public bool StartActive = false;

    private float _fullPlumeRate;
    public float FullLampIntensity = 0.5f;

    // Use this for initialization
    void Start()
    {
        if (Plume != null)
        {
            _fullPlumeRate = Plume.emission.rateOverTime.constant;
        }
        if (!StartActive)
        {
            TurnOff();
        }
    }
    
    public void TurnOn(float proportion = 1)
    {
        Debug.Log("on, " + proportion);
        StartActive = true;
        SetPlumeState(1);
    }

    public void TurnOff()
    {
        Debug.Log("off");
        StartActive = false;
        SetPlumeState(0);
    }

    private void SetPlumeState(float proportion)
    {
        if(Plume != null)
        {
            if (proportion > 0)
            {
                //Debug.Log("turning plume on");
                Plume.Play();

                //reduce rate for throttle.
                var emission = Plume.emission;
                var rate = emission.rateOverTime;
                rate.constant = _fullPlumeRate * proportion;
                emission.rateOverTime = rate;
            }
            else
            {
                //Debug.Log("turning plume off");
                Plume.Stop();
            }
        }
        if(Lamp != null)
        {
            Lamp.intensity -= FullLampIntensity * proportion;
        }
    }

}
