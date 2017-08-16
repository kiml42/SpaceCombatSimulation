using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class EngineControler : MonoBehaviour {
	// Use this for initialization
	void Start () {
        var particleSystem = transform.Find("EnginePlume").GetComponent<ParticleSystem>();
        particleSystem.Stop();
        
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

    // Update is called once per frame
    void Update () {
        //if (!_parentFound)
        //{
        //    Start();
        //}
	}
}
