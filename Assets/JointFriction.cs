using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class JointFriction : MonoBehaviour {

    [Tooltip("mulitiplier for the angular velocity for the torque to apply.")]
    public float Friction = 1;

    private HingeJoint _hinge;
    private Rigidbody _thisBody;
    private Rigidbody _connectedBody;
    private Vector3 _axis;  //local space
    private Vector3 _anchor;    //local space

	// Use this for initialization
	void Start () {
        _hinge = GetComponent<HingeJoint>();
        _connectedBody = _hinge.connectedBody;
        _axis = _hinge.axis;
        _anchor = _hinge.anchor;
	}
	
	// Update is called once per frame
	void FixedUpdate () {
        var angularV = _hinge.velocity;
        Debug.Log("angularV " + angularV);
        var torque = Friction * angularV * _axis;

        _thisBody.AddRelativeTorque(-torque);
        //_connectedBody.AddRelativeTorque(-torque);

    }
}
