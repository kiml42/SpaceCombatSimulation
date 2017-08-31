using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class EngineControler : MonoBehaviour {
    public Vector3 EngineForce;
    public Rigidbody ForceApplier;
    public bool IsOn;
    public ParticleSystem Plume;
    private bool _active = true;
    private string InactiveTag = "Untagged";

    // Use this for initialization
    void Start () {
        if(!IsOn)
            TurnOff();  //to deactivate the particle system if off
        
        Transform parent = FindOldestParent(transform);
        
        if(parent != transform)
        {
            NotifyParent(parent);
        }
    }

    private Transform FindOldestParent(Transform transform)
    {
        var parent = transform.parent;
        if(parent == null)
        {
            return transform;
        }
        return FindOldestParent(parent);
    }

    private void NotifyParent(Transform parent)
    {
        //Debug.Log("Registering engine with " + parent);
        parent.SendMessage("RegisterEngine", transform, SendMessageOptions.DontRequireReceiver);
    }

    public void TurnOn()
    {
        if (_active)
        {
            IsOn = true;
            Plume.Play();
        } else
        {
            TurnOff();
        }
    }

    public void TurnOff()
    {
        IsOn = false;
        Plume.Stop();
    }


    // Update is called once per frame
    void Update () {
        if (IsOn && _active)
        {
            ForceApplier.AddRelativeForce(EngineForce);
        }
    }

    public void Deactivate()
    {
        //Debug.Log("Deactivating " + name);
        _active = false;
        TurnOff();
        tag = InactiveTag;
    }
}
