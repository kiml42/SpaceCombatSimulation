using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class LampAndParticlesEffectController : MonoBehaviour {
    public ParticleSystem Plume;
    public Light Lamp;

    private bool _active = true;

    public float _fullPlumeRate;
    private float _intensityScaler;

    // Use this for initialization
    void Start()
    {
        if (Plume != null)
        {
            _fullPlumeRate = Plume.emission.rateOverTime.constant;
        }
        if(Lamp != null)
        {
            _intensityScaler = Lamp.intensity;
        }
    }
    
    public void TurnOn(float proportion = 1)
    {
        _active = true;
        SetPlumeState(1);
    }

    public void TurnOff()
    {
        _active = false;
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
            Lamp.intensity -= _intensityScaler * proportion;
        }
    }

}
