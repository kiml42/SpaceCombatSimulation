using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class HighSpeedProjectile : MonoBehaviour {
    private Vector3 _previousLocation;
	// Use this for initialization
	void Start () {
        Debug.Log(this);
        _previousLocation = transform.position;
    }
	
	// Update is called once per frame
	void FixedUpdate () {
        Debug.Log("Casting Ray from " + _previousLocation + " to " + transform.position);
        var displacement = transform.position - _previousLocation;
        RaycastHit hit;
        var ray = new Ray(_previousLocation, displacement);
        if (Physics.Raycast(ray, out hit, displacement.magnitude, -1, QueryTriggerInteraction.Ignore))
        {
            //is a hit
            Debug.Log(hit.transform);
            transform.position = hit.point;
        }

        _previousLocation = transform.position;
    }
}
