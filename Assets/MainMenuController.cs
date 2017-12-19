using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class MainMenuController : MonoBehaviour {
    public Camera Camera;
    public Transform CameraTarget;
    public float CameraMoveSpeed = 10;
    public float CameraRotateSpeed = 30;

    // Use this for initialization
    void Start () {
		
	}
	
	// Update is called once per frame
	void Update () {
        //TODO make this move nicer.
        Camera.transform.position = Vector3.MoveTowards(Camera.transform.position, CameraTarget.position, Time.deltaTime * CameraMoveSpeed);
        Camera.transform.rotation = Quaternion.RotateTowards(Camera.transform.rotation, CameraTarget.rotation, Time.deltaTime * CameraRotateSpeed);
    }
}
