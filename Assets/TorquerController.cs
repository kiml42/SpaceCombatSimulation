using Assets.Src.ObjectManagement;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class TorquerController : MonoBehaviour {
    // Use this for initialization
    void Start()
    {
        Transform parent = transform.FindOldestParent();

        if (parent != transform)
        {
            NotifyParent(parent);
        }
    }

    private void NotifyParent(Transform parent)
    {
        parent.SendMessage("RegisterTorquer", transform, SendMessageOptions.DontRequireReceiver);
    }

    // Update is called once per frame
    void Update()
    {
        //if (!_parentFound)
        //{
        //    Start();
        //}
    }
}
