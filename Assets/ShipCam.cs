using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System.Linq;
using System;

public class ShipCam : MonoBehaviour {

    public string SpaceShipTag = "SpaceShip";
    public float RotationSpeed = 0.5f;
    public float TranslateSpeed = 0.5f;
    public Transform _shipToFollow;
    private Transform _focus;
    public Camera Camera;

    public float FocusAngleIntercept = 90;
    public float FocusAngleNumerator = 10;
    public float SetbackIntercept = -50;
    public float SetBackDenominator = 2;


    // Use this for initialization
    void Start () {
        _focus = Instantiate(new GameObject("Focus")).transform;
        _focus.parent = transform;
        Debug.Log(_focus);
    }
	
	// Update is called once per frame
	void Update () {
        var ships = GameObject.FindGameObjectsWithTag(SpaceShipTag)
            .Where(s =>
                s.transform.parent != null &&
                s.transform.parent.GetComponent("Rigidbody") != null
            )
            .Select(s => s.transform.parent)
            .OrderBy(s=> Vector3.Distance(s.position, transform.position));

        if (ships.FirstOrDefault() != null)
        {
            if (Input.GetKeyUp(KeyCode.Z) && ships.Count() > 1)
            {
                _shipToFollow = ships.OrderBy(s => UnityEngine.Random.value).First();
                transform.position = _shipToFollow.position;
            }
            else
            {
                _shipToFollow = ships.First();
                transform.position = Vector3.Slerp(transform.position, ships.First().position, Time.deltaTime * TranslateSpeed);
            }
            
            //retrieve the closest ship with a different tag - prevents following other parts and projectiles from the same ship.
            var target = ships.FirstOrDefault(s => s.tag != _shipToFollow.tag);
            if (target != null)
            {
                var _direction = (target.transform.position - transform.position).normalized;
                var _lookRotation = Quaternion.LookRotation(_direction);
                transform.rotation = Quaternion.Slerp(transform.rotation, _lookRotation, Time.deltaTime * RotationSpeed);
                _focus.position = Vector3.Slerp(_focus.position, target.position, Time.deltaTime * TranslateSpeed/3);
            }
            else
            {
                Debug.Log("Camera found no ships to turn to. Tag being followed: " + _shipToFollow.tag);
            }
            if(Camera != null)
            {
                var focusDistance = Vector3.Distance(transform.position, _focus.position);
                var angle = /*Clamp(*/FocusAngleIntercept + (FocusAngleNumerator/focusDistance)/*, 5, 90)*/;
                Camera.fieldOfView = angle;
                var setBack = SetbackIntercept - focusDistance / SetBackDenominator;
                var camPosition = Camera.transform.localPosition;
                camPosition.z = setBack;
                Camera.transform.localPosition = camPosition;
            }
        }

    }
    public static float Clamp(float value, float min, float max)
    {
        return (value < min) ? min : (value > max) ? max : value;
    }
}
